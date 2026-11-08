<script lang="ts">
	import Icon from './Icon.svelte';
	import type { Collection, Scope } from '$lib/types';

	type Props = {
		scope: Scope; selectedCollection: string; collections: Collection[]; email: string; isAdmin: boolean;
		theme: 'system' | 'light' | 'dark'; invitationLink: string; open: boolean;
		onselect: (scope: Scope, collection?: string) => void; onnewcollection: () => void; oninvite: () => void;
		ontheme: (value: 'system' | 'light' | 'dark') => void; onsignout: () => void; onclose: () => void;
	};
	let { scope, selectedCollection, collections, email, isAdmin, theme, invitationLink, open, onselect, onnewcollection, oninvite, ontheme, onsignout, onclose }: Props = $props();
	const views = [
		{ scope: 'library', label: 'Library', icon: 'image' },
		{ scope: 'favorites', label: 'Favorites', icon: 'heart' },
		{ scope: 'shared', label: 'Shared', icon: 'share' },
		{ scope: 'discover', label: 'Discover', icon: 'globe' }
	] as const;
	let sidebar: HTMLElement = $state(undefined!);
	// On small screens the sidebar is a drawer: move focus into it and let Escape close it.
	$effect(() => { if (open) sidebar.querySelector<HTMLElement>('.nav-item')?.focus(); });
</script>

<svelte:window onkeydown={(event) => { if (open && event.key === 'Escape') onclose(); }} />
{#if open}<button class="scrim" aria-label="Close menu" onclick={onclose}></button>{/if}
<aside class="sidebar" class:open bind:this={sidebar}>
	<div class="brand"><img class="brand-mark" src="/favicon.svg" alt="" width="24" height="24" /><span>Lmacaw</span></div>
	<nav aria-label="Library">
		{#each views as view (view.scope)}
			<button class="nav-item" class:active={scope === view.scope} aria-current={scope === view.scope ? 'page' : undefined} onclick={() => onselect(view.scope)}>
				<Icon name={view.icon} size={16} /><span>{view.label}</span>
			</button>
		{/each}
		<div class="nav-heading"><span>Collections</span><button class="icon-button small" aria-label="New collection" title="New collection" onclick={onnewcollection}><Icon name="plus" size={15} /></button></div>
		{#each collections as collection (collection.id)}
			<button class="nav-item" class:active={scope === 'collection' && selectedCollection === collection.id} aria-current={scope === 'collection' && selectedCollection === collection.id ? 'page' : undefined} onclick={() => onselect('collection', collection.id)}>
				<Icon name="folder" size={16} /><span>{collection.name}</span>
			</button>
		{:else}
			<p class="nav-empty">No collections</p>
		{/each}
	</nav>
	<div class="sidebar-footer">
		{#if isAdmin}
			<button class="nav-item" onclick={oninvite}><Icon name="link" size={16} /><span>Invite</span></button>
			{#if invitationLink}
				<label class="field-label" for="invite-link">Invitation link</label>
				<input id="invite-link" class="input compact" value={invitationLink} readonly onfocus={(event) => event.currentTarget.select()} />
			{/if}
		{/if}
		<label class="field-label" for="theme">Appearance</label>
		<select id="theme" class="input compact" value={theme} onchange={(event) => ontheme(event.currentTarget.value as 'system' | 'light' | 'dark')}>
			<option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
		</select>
		<div class="account"><span class="account-email" title={email}>{email}</span><button class="text-button" onclick={onsignout}>Sign out</button></div>
	</div>
</aside>
