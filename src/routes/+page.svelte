<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import Gallery from '$lib/components/Gallery.svelte';
	import DetailDialog from '$lib/components/DetailDialog.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import { lightDismiss } from '$lib/dialog';
	import type { Collection, Discovery, Item, Scope } from '$lib/types';
	import { fetchAndUpload, uploadFile } from '$lib/upload';
	import { sha256Of } from '$lib/thumbnail';
	import { viewFromUrl, viewHref } from '$lib/view';

	let { data } = $props();
	const user = $derived(data.user);
	const publicMode = $derived(data.mode === 'public');
	const publicLibrary = $derived(publicMode && !data.isAdmin);
	const showLibrary = $derived(publicMode || Boolean(user));

	let email = $state(''), password = $state(''), ready = $state(false);
	let emailInput = $state<HTMLInputElement>(undefined!);
	let signInPending = $state(false), signInSent = $state(false);
	let message = $state(''), messageDownload = $state<Item | null>(null), messageTimer: ReturnType<typeof setTimeout> | undefined;
	let canCopy = $state(true), menuButton: HTMLButtonElement = $state(undefined!);
	let pasteKey = $state('Ctrl+V'), dropActive = $state(false);
	let staged: { id: string; file: File; hash: string; preview: string; failed: boolean }[] = $state([]), stageNote = $state('');
	const view = $derived(viewFromUrl(page.url));
	const selectedScope = $derived(view.scope), selectedCollection = $derived(view.collection);
	let query = $state('');
	const scope = $derived<Scope>(publicLibrary ? 'shared' : selectedScope);
	let theme = $state<'system' | 'light' | 'dark'>('system'), menuOpen = $state(false), dragging = $state(false);
	let items: Item[] = $state([]), loaded = $state(false), loadFailed = $state(false), hasMore = $state(false), currentPage = 1, semanticAvailable = $state(false);
	let discoveries: Discovery[] = $state([]), discovering = $state(false);
	let collections: Collection[] = $state([]), itemCollections: Collection[] = $state([]);
	let current: Item | null = $state(null);
	let invitationLink = $state('');
	let formDialog: HTMLDialogElement = $state(undefined!), addForm: HTMLFormElement = $state(undefined!), fileInput: HTMLInputElement = $state(undefined!);
	let form = $state<{ kind: 'add' | 'collection' | 'rename'; value: string; error: string; progress: string }>({ kind: 'add', value: '', error: '', progress: '' });
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
			if (!response.ok) { failLoad(page); return; }
			const result = await response.json();
			if (requestId !== requestNumber) return;
			const seen = new Set(items.map((item) => item.id));
			items = page === 1 ? result.items : [...items, ...result.items.filter((item: Item) => !seen.has(item.id))];
			if (page === 1) semanticAvailable = result.semanticAvailable;
			hasMore = result.hasMore; currentPage = page; loaded = true; loadFailed = false;
		} catch { if (requestId === requestNumber) failLoad(page); }
	}
	// A failed first page has nothing to show, so it gets an inline retry instead of a toast.
	function failLoad(page: number) {
		if (page === 1 && !loaded) loadFailed = true;
		else notify('Could not load memes.');
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
	function resetView() {
		query = ''; discoveries = []; items = []; loaded = false; loadFailed = false; void refresh();
	}
	// A new view in the URL (a click, Back, or a link to "/") starts fresh; picking the current one again resets it.
	$effect(() => {
		void scope; void selectedCollection;
		if (showLibrary) untrack(resetView);
	});
	function select(next: Scope, collection = '') {
		closeMenu();
		const href = viewHref(next, collection);
		if (href === page.url.pathname + page.url.search) resetView();
		else void goto(href, { keepFocus: true, noScroll: true });
	}

	async function signIn(event: SubmitEvent) {
		event.preventDefault();
		if (signInPending) return;
		const setup = data.needsSetup;
		signInPending = true; signInSent = false; message = '';
		try {
			const response = await api(setup ? '/api/v1/setup' : '/api/v1/session', 'POST', { email, password });
			if (setup ? response.status === 201 || response.status === 409 : response.status === 204) {
				location.reload();
				return;
			}
			if (response.status === 403) message = setup ? 'Use the administrator email set in ADMIN_EMAIL.' : originMessage;
			else if (response.status === 401) message = 'Wrong email or password.';
			else if (response.status === 429) message = 'Too many attempts. Try again later.';
			else message = setup ? 'Unable to set up Lmacaw.' : 'Unable to sign in.';
		} catch { message = 'Unable to connect.'; }
		finally { signInPending = false; }
	}
	const originMessage = 'Sign-in is not allowed from this address. Open Lmacaw at its main address, or add this one to ORIGIN.';
	async function requestSignInLink() {
		if (signInPending || !emailInput.reportValidity()) return;
		signInPending = true; signInSent = false; message = '';
		try {
			const response = await api('/api/v1/session/link', 'POST', { email });
			if (response.status !== 202) { message = response.status === 429 ? 'Too many attempts. Try again later.' : response.status === 403 ? originMessage : 'Unable to sign in.'; return; }
			signInSent = true;
		} catch { message = 'Unable to connect.'; }
		finally { signInPending = false; }
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

	// Adds land in the open collection too; other views switch to the library to show them.
	const addTarget = () => (scope === 'collection' ? selectedCollection : undefined);
	async function showAdded() {
		if (scope === 'library' || scope === 'collection') await refresh(); else select('library');
	}

	// Every add is previewed in the Add dialog first; nothing uploads until "Add N".
	const adding = () => formDialog?.open && form.kind === 'add';
	async function stage(files: FileList | File[]) {
		const images = Array.from(files).filter((file) => file.type.startsWith('image/'));
		if (!images.length) return;
		if (!adding()) { if (formDialog.open) return; openForm('add'); }
		// The same bytes twice (e.g. pasting one image again) are staged once.
		let skipped = 0;
		for (const file of images) {
			const hash = await sha256Of(file);
			if (!adding()) return;
			if (staged.some((entry) => entry.hash === hash)) { skipped++; continue; }
			staged = [...staged, { id: crypto.randomUUID(), file, hash, preview: URL.createObjectURL(file), failed: false }];
		}
		stageNote = skipped ? `Skipped duplicate ${skipped === 1 ? 'image' : 'images'}.` : '';
	}
	function unstage(id: string) {
		const entry = staged.find((candidate) => candidate.id === id);
		if (entry) URL.revokeObjectURL(entry.preview);
		staged = staged.filter((candidate) => candidate.id !== id);
	}
	function clearStaged() {
		for (const entry of staged) URL.revokeObjectURL(entry.preview);
		staged = []; stageNote = ''; dropActive = false;
	}

	// One URL per line, fetched through the image proxy into the preview; failed lines stay in the box.
	async function previewUrls() {
		const urls = [...new Set(form.value.split('\n').map((line) => line.trim()).filter(Boolean))];
		if (!urls.length) { form.error = 'Paste at least one image URL.'; return; }
		if (urls.length > 50) { form.error = 'Paste up to 50 URLs at a time.'; return; }
		form.error = '';
		const failed: string[] = [], files: File[] = [];
		for (const [index, url] of urls.entries()) {
			form.progress = `Loading ${index + 1} of ${urls.length}…`;
			const attempt = () => fetch(`/api/v1/fetch?${new URLSearchParams({ url })}`).catch(() => null);
			let response = await attempt();
			if (!response?.ok) response = await attempt(); // one retry: remote hosts fail now and then
			if (!response?.ok) { failed.push(url); continue; }
			const blob = await response.blob();
			files.push(new File([blob], url.split(/[?#]/)[0].split('/').pop() || 'image', { type: blob.type }));
		}
		form.progress = ''; form.value = failed.join('\n');
		await stage(files);
		if (failed.length) form.error = `${failed.length === 1 ? '1 link' : `${failed.length} links`} could not be loaded. Use public links to PNG, JPEG, WebP, or GIF files.`;
	}

	async function uploadStaged() {
		const collection = addTarget(), queue = [...staged];
		let added = 0, duplicates = 0, failed = 0;
		form.error = '';
		for (const [index, entry] of queue.entries()) {
			form.progress = `Uploading ${index + 1} of ${queue.length}…`;
			let ok = false;
			try {
				const response = await uploadFile(entry.file, { collection });
				if (response.ok) { ok = true; if ((await response.json()).duplicate) duplicates++; else added++; }
			} catch { /* counted below */ }
			if (ok) unstage(entry.id);
			else { failed++; staged = staged.map((candidate) => (candidate.id === entry.id ? { ...candidate, failed: true } : candidate)); }
		}
		form.progress = '';
		if (added || duplicates) await showAdded();
		const summary = [added && (added === 1 ? 'Added.' : `Added ${added}.`), duplicates && `${duplicates} already in your library.`].filter(Boolean).join(' ');
		if (failed) { form.error = `${summary} Could not add ${failed === 1 ? '1 image' : `${failed} images`}.`.trim(); return; }
		formDialog.close(); notify(summary);
	}

	// Files are staged; an image dragged from another page usually brings only its URL, which is loaded.
	function dropInAdd(event: DragEvent) {
		dropActive = false;
		const data = event.dataTransfer;
		if (data?.files.length) { event.preventDefault(); void stage(data.files); return; }
		const urls = (data?.getData('text/uri-list') ?? '').split(/\r?\n/).filter((line) => line && !line.startsWith('#'));
		if (!urls.length) return; // plain text can still drop into the URL box
		event.preventDefault();
		form.value = [form.value.trim(), ...urls].filter(Boolean).join('\n');
		void previewUrls();
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
	let savingDiscovery: string[] = $state([]);
	async function saveDiscovery(item: Discovery) {
		if (item.saved || savingDiscovery.includes(item.id)) return;
		savingDiscovery.push(item.id);
		try {
			const response = await fetchAndUpload({ openverse: item.id }).catch(() => null);
			if (!response?.ok) { notify('Could not save image.'); return; }
			const target = discoveries.find((candidate) => candidate.id === item.id);
			if (target) target.saved = true;
			notify((await response.json().catch(() => ({}))).duplicate ? 'Already in your library.' : 'Saved to your library.');
		} finally {
			savingDiscovery = savingDiscovery.filter((id) => id !== item.id);
		}
	}

	function openForm(kind: 'add' | 'collection' | 'rename') {
		form = { kind, value: kind === 'rename' ? collectionName : '', error: '', progress: '' };
		formDialog.showModal();
	}
	async function submitForm(event: SubmitEvent) {
		event.preventDefault(); form.error = '';
		try {
			if (form.kind === 'add') {
				await uploadStaged();
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
		if (/Mac|iPhone|iPad/.test(navigator.userAgent)) pasteKey = '⌘V';
		// app.html already applied the saved theme; sync the toggle with it.
		const saved = document.documentElement.dataset.theme;
		if (saved === 'light' || saved === 'dark') theme = saved;
		if (!showLibrary || publicLibrary) return;
		void refreshCollections();
		const paste = (event: ClipboardEvent) => {
			const target = event.target;
			if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) return;
			const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'));
			if (files.length) { event.preventDefault(); void stage(files); }
		};
		document.addEventListener('paste', paste);
		return () => document.removeEventListener('paste', paste);
	});
</script>

<svelte:head><title>{user && !publicLibrary ? `${title} · Lmacaw` : 'Lmacaw'}</title></svelte:head>

{#if !showLibrary}
	<main class="auth-shell">
		<div class="auth-card">
			<div class="brand"><img class="brand-mark" src="/favicon.svg" alt="" width="24" height="24" /><span>Lmacaw</span></div>
			<h1>{data.needsSetup ? 'Set up Lmacaw' : 'Sign in'}</h1>
			<form method="post" onsubmit={signIn}>
				<label class="field-label" for="email">Email</label>
				<input id="email" class="input" type="email" autocomplete="email" bind:this={emailInput} bind:value={email} required />
				<label class="field-label" for="password">Password</label>
				<input id="password" class="input" type="password" autocomplete={data.needsSetup ? 'new-password' : 'current-password'}
					minlength={data.needsSetup ? 12 : undefined} maxlength="1024" aria-describedby={data.needsSetup ? 'password-hint' : undefined} bind:value={password} required />
				{#if data.needsSetup}<p id="password-hint" class="hint">At least 12 characters</p>{/if}
				<button class="button primary" type="submit" disabled={!ready || signInPending}>{data.needsSetup ? 'Set up' : 'Sign in'}</button>
				{#if !data.needsSetup && data.mailEnabled}
					<button class="text-button auth-secondary" type="button" disabled={!ready || signInPending} onclick={requestSignInLink}>Email me a sign-in link</button>
				{/if}
			</form>
			{#if message}<p class="error" role="alert">{message}</p>{/if}
			{#if signInSent}<p class="notice" role="status">Check your email for a sign-in link.</p>{/if}
		</div>
	</main>
{:else}
	<div
		class="app-shell" class:public-library={publicLibrary} role="presentation"
		ondragover={publicLibrary ? undefined : (event) => { event.preventDefault(); if (event.dataTransfer?.types.includes('Files')) dragging = true; }}
		ondragleave={publicLibrary ? undefined : (event) => { if (!event.relatedTarget) dragging = false; }}
		ondrop={publicLibrary ? undefined : (event) => { event.preventDefault(); dragging = false; if (event.dataTransfer?.files.length) void stage(event.dataTransfer.files); }}
	>
		{#if !publicLibrary && user}
			<Sidebar
				{scope} {selectedCollection} {collections} {theme} {invitationLink} open={menuOpen}
				email={user.email} canInvite={data.isAdmin && !publicMode} {publicMode}
				onselect={select} onnewcollection={() => openForm('collection')} oninvite={invite}
				ontheme={setTheme} onsignout={signOut} onclose={closeMenu}
			/>
		{/if}
		<main class="workspace" inert={menuOpen}>
			<header class="topbar">
				{#if publicLibrary}
					<h1><a class="brand" href="/"><img class="brand-mark" src="/favicon.svg" alt="" width="24" height="24" />Lmacaw</a></h1>
				{:else}
					<button class="icon-button menu-button" aria-label="Menu" aria-expanded={menuOpen} bind:this={menuButton} onclick={() => (menuOpen = true)}><Icon name="menu" /></button>
					<h1>{title}</h1>
				{/if}
				{#if scope === 'collection'}
					<button class="icon-button" aria-label="Rename collection" title="Rename" onclick={() => openForm('rename')}><Icon name="pencil" size={16} /></button>
					<button class="icon-button" aria-label="Delete collection" title="Delete collection" onclick={deleteCollection}><Icon name="trash" size={16} /></button>
				{/if}
				<div class="search">
					<Icon name="search" size={15} />
					<label class="sr-only" for="search">Search</label>
					<input id="search" type="search" placeholder={scope === 'discover' ? 'Search Openverse' : 'Search'} bind:value={query} oninput={queueSearch} onkeydown={(event) => { if (event.key === 'Enter' && scope === 'discover') void discover(); }} />
				</div>
				{#if !publicLibrary}
					<button class="button primary add-button" disabled={!ready} onclick={() => openForm('add')}><Icon name="plus" size={15} />Add</button>
					{#if ready}<input hidden bind:this={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onchange={(event) => { if (event.currentTarget.files) void stage(event.currentTarget.files); event.currentTarget.value = ''; }} />{/if}
				{:else}
					<!-- Public visitors have no sidebar, so the appearance toggle lives here. -->
					<ThemeToggle {theme} ontheme={setTheme} disabled={!ready} />
				{/if}
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
									<button class="tile-action labeled" aria-label={`${item.saved ? 'Saved' : 'Save'} ${item.title || 'image'}`} disabled={item.saved || savingDiscovery.includes(item.id)} onclick={() => saveDiscovery(item)}><Icon name="bookmark" size={14} />{item.saved ? 'Saved' : savingDiscovery.includes(item.id) ? 'Saving…' : 'Save'}</button>
								</div>
							</li>
						{/each}
					</ul>
				{:else}
					<div class="empty"><p>{discovering ? 'Searching…' : 'Search openly licensed images on Openverse.'}</p><p class="hint">Results may include few memes. Check each license at its source.</p></div>
				{/if}
			{:else if items.length}
				<Gallery {items} {canCopy} {publicLibrary} shared={scope === 'shared'} onopen={openItem} oncopy={copyImage} onfavorite={(item) => updateItem(item, { favorite: !item.favorite })} onsave={saveShared} />
				{#if hasMore}<div class="more"><button class="button ghost" onclick={() => refresh(currentPage + 1)}>Load more</button></div>{/if}
			{:else if loadFailed}
				<div class="empty"><p>Could not load memes.</p><button class="button ghost" onclick={() => { loadFailed = false; void refresh(); }}>Retry</button></div>
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
		{#if message && !current}<p class="toast" role="status">{message}{#if messageDownload} <a href={`/api/v1/items/${messageDownload.id}/media?download=1`} download>Download</a>{/if}</p>{/if}
	</div>

	<DetailDialog
		item={current} {canCopy} {publicLibrary} {publicMode} readonly={scope === 'shared'} collections={itemCollections} message={current ? message : ''} aiEnabled={data.aiEnabled}
		onclose={() => (current = null)} oncopy={copyImage} onupdate={updateItem} ondelete={removeItem}
		onsave={saveShared} onretry={retryAi} ontogglecollection={toggleCollection}
	/>

	{#if !publicLibrary}<dialog bind:this={formDialog} use:lightDismiss class="form-dialog" aria-labelledby="form-title" onclose={clearStaged}
		ondragover={(event) => { if (form.kind === 'add') { event.preventDefault(); dropActive = true; } }}
		ondragleave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) dropActive = false; }}
		ondrop={(event) => { if (form.kind === 'add') dropInAdd(event); }}>
		<form onsubmit={submitForm} bind:this={addForm}>
			<h2 id="form-title">{form.kind === 'add' ? 'Add images' : form.kind === 'collection' ? 'New collection' : 'Rename collection'}</h2>
			{#if form.kind === 'add'}
				<!-- svelte-ignore a11y_autofocus -->
				<button type="button" class="dropzone" class:active={dropActive} autofocus onclick={() => fileInput.click()}>
					<Icon name="image" size={22} />
					<span>Drop images here, or click to choose</span>
					<span class="hint paste-hint">Paste with {pasteKey}</span>
				</button>
				{#if staged.length}
					<ul class="staged" aria-label="Images to add">
						{#each staged as entry (entry.id)}
							<li class:failed={entry.failed}>
								<img src={entry.preview} alt={entry.file.name} />
								<button type="button" aria-label={`Remove ${entry.file.name}`} disabled={Boolean(form.progress)} onclick={() => unstage(entry.id)}><Icon name="x" size={13} /></button>
							</li>
						{/each}
					</ul>
				{/if}
				{#if stageNote}<p class="hint stage-note" role="status">{stageNote}</p>{/if}
				<label class="field-label url-label" for="form-value">Image URLs</label>
				<textarea id="form-value" class="input url-list" rows="3" placeholder={'https://…/first.jpg\nhttps://…/second.gif'} aria-describedby="form-hint" bind:value={form.value}
					onkeydown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void previewUrls(); } }}></textarea>
				<div class="url-row">
					<p id="form-hint" class="hint">One link per line.</p>
					<button class="button ghost" type="button" disabled={!form.value.trim() || Boolean(form.progress)} onclick={previewUrls}>Preview</button>
				</div>
			{:else}
				<label class="field-label" for="form-value">Collection name</label>
				<input id="form-value" class="input" maxlength="80" bind:value={form.value} required />
			{/if}
			{#if form.error}<p class="error" role="alert">{form.error}</p>{/if}
			<div class="form-actions">
				<button class="button ghost" type="button" onclick={() => formDialog.close()}>Cancel</button>
				<button class="button primary" type="submit" disabled={Boolean(form.progress) || (form.kind === 'add' && !staged.length)}>{form.progress || (form.kind === 'add' ? (staged.length ? `Add ${staged.length}` : 'Add') : form.kind === 'collection' ? 'Create' : 'Rename')}</button>
			</div>
		</form>
	</dialog>{/if}
{/if}
