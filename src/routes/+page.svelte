<script lang="ts">
	import { onMount, tick } from 'svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import Gallery from '$lib/components/Gallery.svelte';
	import DetailDialog from '$lib/components/DetailDialog.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import type { Collection, Discovery, Item, Scope } from '$lib/types';

	let { data } = $props();
	const user = $derived(data.user);

	let email = $state(''), password = $state(''), ready = $state(false);
	let message = $state(''), messageDownload = $state<Item | null>(null), messageTimer: ReturnType<typeof setTimeout> | undefined;
	let canCopy = $state(true), menuButton: HTMLButtonElement = $state(undefined!);
	let scope = $state<Scope>('library'), selectedCollection = $state(''), query = $state('');
	let theme = $state<'system' | 'light' | 'dark'>('system'), menuOpen = $state(false), dragging = $state(false);
	let items: Item[] = $state([]), loaded = $state(false), hasMore = $state(false), currentPage = 1, semanticAvailable = $state(false);
	let discoveries: Discovery[] = $state([]), discovering = $state(false);
	let collections: Collection[] = $state([]), itemCollections: Collection[] = $state([]);
	let current: Item | null = $state(null);
	let invitationLink = $state('');
	let formDialog: HTMLDialogElement = $state(undefined!), fileInput: HTMLInputElement = $state(undefined!);
	let form = $state<{ kind: 'url' | 'collection' | 'rename'; value: string; error: string }>({ kind: 'url', value: '', error: '' });
	let requestNumber = 0, searchTimer: ReturnType<typeof setTimeout> | undefined;

	const collectionName = $derived(collections.find((collection) => collection.id === selectedCollection)?.name ?? 'Collection');
	const title = $derived({ library: 'Library', favorites: 'Favorites', shared: 'Shared', discover: 'Discover', collection: collectionName }[scope]);

	// A message that offers a download stays longer, so there is time to reach its link.
	function notify(text: string, download: Item | null = null) {
		message = text; messageDownload = download;
		if (messageTimer) clearTimeout(messageTimer);
		messageTimer = setTimeout(() => { message = ''; messageDownload = null; }, download ? 10000 : 4000);
	}
	async function api(path: string, method = 'GET', body?: unknown) {
		return fetch(path, body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
	}

	async function refresh(page = 1) {
		if (scope === 'discover') return;
		const requestId = ++requestNumber;
		const params = new URLSearchParams({ scope: scope === 'collection' ? 'library' : scope, q: query, page: String(page) });
		if (scope === 'collection') params.set('collection', selectedCollection);
		try {
			const response = await fetch(`/api/v1/items?${params}`);
			if (requestId !== requestNumber) return;
			if (!response.ok) { notify('Could not load memes.'); return; }
			const result = await response.json();
			if (requestId !== requestNumber) return;
			const seen = new Set(items.map((item) => item.id));
			items = page === 1 ? result.items : [...items, ...result.items.filter((item: Item) => !seen.has(item.id))];
			if (page === 1) semanticAvailable = result.semanticAvailable;
			hasMore = result.hasMore; currentPage = page; loaded = true;
		} catch { if (requestId === requestNumber) notify('Could not load memes.'); }
	}
	function queueSearch() {
		if (searchTimer) clearTimeout(searchTimer);
		if (scope !== 'discover') { requestNumber++; searchTimer = setTimeout(() => void refresh(), 300); }
	}
	async function refreshCollections() {
		const response = await fetch('/api/v1/collections');
		if (response.ok) collections = (await response.json()).collections;
	}
	function closeMenu() {
		if (!menuOpen) return;
		// Focus after the workspace stops being inert.
		menuOpen = false; void tick().then(() => menuButton?.focus());
	}
	function select(next: Scope, collection = '') {
		closeMenu();
		scope = next; selectedCollection = collection; query = ''; discoveries = [];
		items = []; loaded = false; void refresh();
	}

	// Sessions: reload the whole page on sign-in and sign-out, so no private state or in-flight
	// response from one account can survive into another.
	async function signIn(event: SubmitEvent) {
		event.preventDefault(); message = '';
		try {
			const response = await api('/api/v1/session', 'POST', { email, password });
			if (!response.ok) { message = response.status === 429 ? 'Too many attempts. Try again later.' : 'Unable to sign in.'; return; }
			password = ''; window.location.assign('/');
		} catch { message = 'Unable to connect.'; }
	}
	async function signOut() {
		await fetch('/api/v1/session', { method: 'DELETE' }).catch(() => {});
		window.location.assign('/');
	}
	async function invite() {
		const response = await fetch('/api/v1/invitations', { method: 'POST' });
		if (!response.ok) { notify('Could not create invitation.'); return; }
		invitationLink = `${window.location.origin}/invite#${(await response.json()).token}`;
	}

	async function addFiles(files: FileList | File[]) {
		const list = Array.from(files);
		let added = 0, duplicates = 0, failed: string[] = [];
		for (const file of list) {
			const body = new FormData(); body.set('file', file);
			try {
				const response = await fetch('/api/v1/items', { method: 'POST', body });
				if (!response.ok) failed.push(file.name);
				else if ((await response.json()).duplicate) duplicates++;
				else added++;
			} catch { failed.push(file.name); }
		}
		if (failed.length) notify(`Could not add ${failed.join(', ')}.`);
		else if (duplicates && !added) notify('Already in your library.');
		else notify(added === 1 ? 'Added.' : `Added ${added}.`);
		if (scope !== 'library') select('library'); else await refresh();
	}

	async function openItem(item: Item) {
		current = item; itemCollections = [];
		if (scope === 'shared') return;
		const response = await fetch(`/api/v1/collections?${new URLSearchParams({ item: item.id })}`);
		if (response.ok && current?.id === item.id) itemCollections = (await response.json()).collections;
	}
	async function updateItem(item: Item, patch: Record<string, unknown>) {
		const response = await api(`/api/v1/items/${item.id}`, 'PATCH', patch);
		if (!response.ok) { notify('Could not update meme.'); return; }
		const { extractedText, ...rest } = patch;
		const local = { ...item, ...rest, ...(extractedText !== undefined ? { extracted_text: extractedText as string } : {}) } as Item;
		items = items.map((candidate) => (candidate.id === item.id ? local : candidate));
		if (current?.id === item.id) current = local;
		if ('description' in patch) notify('Saved.');
		await refresh();
		// Keep the open item even if it no longer matches the current view (e.g. unfavorited in Favorites).
		if (current?.id === item.id) current = items.find((candidate) => candidate.id === item.id) ?? local;
	}
	async function toggleCollection(collection: Collection, checked: boolean) {
		if (!current) return;
		const response = checked
			? await api(`/api/v1/collections/${collection.id}/items`, 'POST', { itemId: current.id })
			: await fetch(`/api/v1/collections/${collection.id}/items?${new URLSearchParams({ itemId: current.id })}`, { method: 'DELETE' });
		if (!response.ok) { notify('Could not update collection.'); return; }
		itemCollections = itemCollections.map((entry) => (entry.id === collection.id ? { ...entry, hasItem: checked } : entry));
		if (scope === 'collection') await refresh();
	}
	async function removeItem(item: Item) {
		if (!confirm('Delete this meme? This cannot be undone.')) return;
		const response = await fetch(`/api/v1/items/${item.id}`, { method: 'DELETE' });
		if (!response.ok) { notify('Could not delete meme.'); return; }
		current = null; await refresh();
	}
	// Clipboards accept PNG, not GIF, so animated GIFs copy their first frame only.
	async function pngOf(item: Item): Promise<Blob> {
		const response = await fetch(`/api/v1/items/${item.id}/media`);
		if (!response.ok) throw new Error('Media unavailable');
		const blob = await response.blob();
		if (blob.type === 'image/png') return blob;
		const image = await createImageBitmap(blob);
		const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
		const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas unavailable');
		context.drawImage(image, 0, 0); image.close();
		return new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('Copy failed'))), 'image/png'));
	}
	function copyImage(item: Item) {
		if (!canCopy) { notify('This browser cannot copy images. Download the original instead.', item); return; }
		// Write synchronously inside the click, passing the image as a promise. Firefox and Safari
		// reject a clipboard write that starts after an await, because the click no longer counts.
		const png = pngOf(item);
		png.catch(() => {}); // reported through the write below
		let write: Promise<void>;
		try { write = navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]); }
		catch (error) { write = Promise.reject(error); }
		write.then(
			() => notify(item.content_type === 'image/gif' ? 'Copied first frame. Download to keep the animation.' : 'Copied.'),
			() => notify('Could not copy. Download the original instead.', item)
		);
	}
	async function saveShared(item: Item) {
		const response = await fetch(`/api/v1/items/${item.id}/copy`, { method: 'POST' });
		notify(response.ok ? ((await response.json()).duplicate ? 'Already in your library.' : 'Saved to your library.') : 'Could not save meme.');
	}
	async function retryAi(item: Item) {
		const response = await fetch(`/api/v1/items/${item.id}/retry-ai`, { method: 'POST' });
		if (!response.ok) { notify('Could not retry AI.'); return; }
		notify('AI analysis queued.');
		await refresh();
		if (current?.id === item.id) current = items.find((candidate) => candidate.id === item.id) ?? { ...item, ai_state: 'pending' };
	}

	async function discover() {
		if (!query.trim()) { discoveries = []; return; }
		discovering = true;
		try {
			const response = await fetch(`/api/v1/discover?${new URLSearchParams({ q: query.trim() })}`);
			if (!response.ok) { notify('Openverse is unavailable. Try again later.'); return; }
			discoveries = (await response.json()).items;
			if (!discoveries.length) notify('No images found.');
		} catch { notify('Openverse is unavailable. Try again later.'); }
		finally { discovering = false; }
	}
	async function saveDiscovery(item: Discovery) {
		const response = await api('/api/v1/discover/save', 'POST', { id: item.id });
		notify(response.ok ? 'Saved to your library.' : 'Could not save image.');
	}

	function openForm(kind: 'url' | 'collection' | 'rename') {
		form = { kind, value: kind === 'rename' ? collectionName : '', error: '' };
		formDialog.showModal();
	}
	async function submitForm(event: SubmitEvent) {
		event.preventDefault(); form.error = '';
		try {
			if (form.kind === 'url') {
				const response = await api('/api/v1/import', 'POST', { url: form.value });
				if (!response.ok) { form.error = 'Unable to import image. Use a public link to a PNG, JPEG, WebP, or GIF.'; return; }
				formDialog.close(); notify((await response.json()).duplicate ? 'Already in your library.' : 'Added.');
				if (scope !== 'library') select('library'); else await refresh();
			} else if (form.kind === 'collection') {
				const response = await api('/api/v1/collections', 'POST', { name: form.value });
				if (!response.ok) { form.error = 'Could not create collection. Names must be unique.'; return; }
				formDialog.close(); await refreshCollections();
			} else {
				const response = await api(`/api/v1/collections/${selectedCollection}`, 'PATCH', { name: form.value });
				if (!response.ok) { form.error = 'Could not rename collection. Names must be unique.'; return; }
				formDialog.close(); await refreshCollections();
			}
		} catch { form.error = 'Unable to connect.'; }
	}
	async function deleteCollection() {
		if (!confirm(`Delete “${collectionName}”? Memes stay in your library.`)) return;
		const response = await fetch(`/api/v1/collections/${selectedCollection}`, { method: 'DELETE' });
		if (!response.ok) { notify('Could not delete collection.'); return; }
		await refreshCollections(); select('library');
	}

	function setTheme(value: typeof theme) {
		theme = value;
		try { localStorage.setItem('lmacaw-theme', value); } catch { /* storage unavailable */ }
		if (value === 'system') delete document.documentElement.dataset.theme;
		else document.documentElement.dataset.theme = value;
	}

	onMount(() => {
		ready = true;
		// Missing on older browsers and on plain-HTTP origins other than localhost.
		canCopy = window.isSecureContext && typeof ClipboardItem === 'function' && typeof navigator.clipboard?.write === 'function';
		try { const saved = localStorage.getItem('lmacaw-theme'); if (saved === 'light' || saved === 'dark') setTheme(saved); } catch { /* storage unavailable */ }
		if (!user) return;
		void refresh(); void refreshCollections();
		const paste = (event: ClipboardEvent) => {
			const target = event.target;
			if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) return;
			const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'));
			if (files.length) { event.preventDefault(); void addFiles(files); }
		};
		document.addEventListener('paste', paste);
		return () => document.removeEventListener('paste', paste);
	});
</script>

<svelte:head><title>{user ? `${title} · Lmacaw` : 'Lmacaw'}</title></svelte:head>

{#if !user}
	<main class="auth-shell">
		<div class="auth-card">
			<div class="brand"><span class="brand-mark">L</span><span>Lmacaw</span></div>
			<h1>Sign in</h1>
			<form onsubmit={signIn}>
				<label class="field-label" for="email">Email</label>
				<input id="email" class="input" type="email" autocomplete="username" bind:value={email} required />
				<label class="field-label" for="password">Password</label>
				<input id="password" class="input" type="password" autocomplete="current-password" bind:value={password} required />
				<button class="button primary" type="submit" disabled={!ready}>Sign in</button>
			</form>
			{#if message}<p class="error" role="alert">{message}</p>{/if}
		</div>
	</main>
{:else}
	<div
		class="app-shell" role="presentation"
		ondragover={(event) => { event.preventDefault(); if (event.dataTransfer?.types.includes('Files')) dragging = true; }}
		ondragleave={(event) => { if (!event.relatedTarget) dragging = false; }}
		ondrop={(event) => { event.preventDefault(); dragging = false; if (event.dataTransfer?.files.length) void addFiles(event.dataTransfer.files); }}
	>
		<Sidebar
			{scope} {selectedCollection} {collections} {theme} {invitationLink} open={menuOpen}
			email={user.email} isAdmin={user.isAdmin}
			onselect={select} onnewcollection={() => openForm('collection')} oninvite={invite}
			ontheme={setTheme} onsignout={signOut} onclose={closeMenu}
		/>
		<main class="workspace" inert={menuOpen}>
			<header class="topbar">
				<button class="icon-button menu-button" aria-label="Menu" aria-expanded={menuOpen} bind:this={menuButton} onclick={() => (menuOpen = true)}><Icon name="menu" /></button>
				<h1>{title}</h1>
				{#if scope === 'collection'}
					<button class="icon-button" aria-label="Rename collection" title="Rename" onclick={() => openForm('rename')}><Icon name="pencil" size={16} /></button>
					<button class="icon-button" aria-label="Delete collection" title="Delete collection" onclick={deleteCollection}><Icon name="trash" size={16} /></button>
				{/if}
				<div class="search">
					<Icon name="search" size={15} />
					<label class="sr-only" for="search">Search</label>
					<input id="search" type="search" placeholder={scope === 'discover' ? 'Search Openverse' : 'Search'} bind:value={query} oninput={queueSearch} onkeydown={(event) => { if (event.key === 'Enter' && scope === 'discover') void discover(); }} />
				</div>
				<button class="button ghost hide-small" onclick={() => openForm('url')}>Add URL</button>
				<button class="icon-button show-small" aria-label="Add URL" onclick={() => openForm('url')}><Icon name="link" /></button>
				<button class="button primary" disabled={!ready} onclick={() => fileInput.click()}>Add</button>
				{#if ready}<input hidden bind:this={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onchange={(event) => { if (event.currentTarget.files) void addFiles(event.currentTarget.files); event.currentTarget.value = ''; }} />{/if}
			</header>

			{#if query && scope !== 'discover' && loaded && !semanticAvailable}<p class="subtle-bar">Keyword results only. Semantic search is unavailable.</p>{/if}

			{#if scope === 'discover'}
				{#if discoveries.length}
					<ul class="gallery" aria-label="Openverse results">
						{#each discoveries as item (item.id)}
							<li class="tile discover-tile">
								<img src={`https://api.openverse.org/v1/images/${item.id}/thumb/`} alt={item.title || 'Openverse image'} loading="lazy" referrerpolicy="no-referrer" />
								<div class="discover-overlay">
									<span class="discover-credit">{item.attribution || item.title}</span>
									<button class="tile-action labeled" aria-label={`Save ${item.title || 'image'}`} onclick={() => saveDiscovery(item)}><Icon name="bookmark" size={14} />Save</button>
								</div>
							</li>
						{/each}
					</ul>
				{:else}
					<div class="empty"><p>{discovering ? 'Searching…' : 'Search openly licensed images on Openverse.'}</p><p class="hint">Results may include few memes. Check each license at its source.</p></div>
				{/if}
			{:else if items.length}
				<Gallery {items} {canCopy} shared={scope === 'shared'} onopen={openItem} oncopy={copyImage} onfavorite={(item) => updateItem(item, { favorite: !item.favorite })} onsave={saveShared} />
				{#if hasMore}<div class="more"><button class="button ghost" onclick={() => refresh(currentPage + 1)}>Load more</button></div>{/if}
			{:else if loaded}
				<div class="empty">
					{#if query}<p>No matches.</p>
					{:else if scope === 'library'}<p>No memes yet.</p><p class="hint">Add, paste, or drop images here.</p>
					{:else if scope === 'shared'}<p>Nothing shared yet.</p>
					{:else}<p>Nothing here yet.</p>{/if}
				</div>
			{/if}
		</main>
		{#if dragging}<div class="drop-overlay" aria-hidden="true">Drop to add</div>{/if}
		{#if message && !current}<p class="toast" role="status">{message}{#if messageDownload} <a href={`/api/v1/items/${messageDownload.id}/media`} download>Download</a>{/if}</p>{/if}
	</div>

	<DetailDialog
		item={current} {canCopy} readonly={scope === 'shared'} collections={itemCollections} message={current ? message : ''} aiEnabled={data.aiEnabled}
		onclose={() => (current = null)} oncopy={copyImage} onupdate={updateItem} ondelete={removeItem}
		onsave={saveShared} onretry={retryAi} ontogglecollection={toggleCollection}
	/>

	<dialog bind:this={formDialog} class="form-dialog" aria-labelledby="form-title">
		<form onsubmit={submitForm}>
			<h2 id="form-title">{form.kind === 'url' ? 'Add URL' : form.kind === 'collection' ? 'New collection' : 'Rename collection'}</h2>
			{#if form.kind === 'url'}
				<label class="field-label" for="form-value">Image URL</label>
				<input id="form-value" class="input" type="url" placeholder="https://" bind:value={form.value} required />
			{:else}
				<label class="field-label" for="form-value">Collection name</label>
				<input id="form-value" class="input" maxlength="80" bind:value={form.value} required />
			{/if}
			{#if form.error}<p class="error" role="alert">{form.error}</p>{/if}
			<div class="form-actions">
				<button class="button ghost" type="button" onclick={() => formDialog.close()}>Cancel</button>
				<button class="button primary" type="submit">{form.kind === 'url' ? 'Import' : form.kind === 'collection' ? 'Create' : 'Rename'}</button>
			</div>
		</form>
	</dialog>
{/if}
