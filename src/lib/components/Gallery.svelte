<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import type { Attachment } from 'svelte/attachments';
	import Icon from './Icon.svelte';
	import { tileSrc } from '$lib/media';
	import type { Item } from '$lib/types';

	type Props = { items: Item[]; loading?: boolean; canCopy: boolean; canShareGif: boolean; shared: boolean; publicLibrary: boolean; onopen: (item: Item) => void; oncopy: (item: Item) => void; onfavorite: (item: Item) => void; onsave: (item: Item) => void; onstale: (item: Item) => void };
	let { items, loading = false, canCopy, canShareGif, shared, publicLibrary, onopen, oncopy, onfavorite, onsave, onstale }: Props = $props();

	// GIF tiles show the still thumbnail and load the animated original only while playing:
	// on hover/focus with a mouse, or while mostly on screen on touch (a few at once).
	const MAX_PLAYING = 4;
	const playing = new SvelteSet<string>();
	const play = (id: string, on: boolean) => { if (on) playing.add(id); else playing.delete(id); };
	const mouse = typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;
	const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	// A GIF must stay on screen briefly before it plays, so a fast scroll fetches no originals.
	const timers = new Map<string, ReturnType<typeof setTimeout>>();
	const stop = (id: string) => { clearTimeout(timers.get(id)); timers.delete(id); play(id, false); };
	const observer = !mouse && !calm && typeof IntersectionObserver === 'function'
		? new IntersectionObserver((entries) => {
			for (const entry of entries) {
				const id = (entry.target as HTMLElement).dataset.id!;
				if (entry.intersectionRatio < 0.6) stop(id);
				else if (!timers.has(id)) timers.set(id, setTimeout(() => { timers.delete(id); if (playing.size < MAX_PLAYING) play(id, true); }, 300));
			}
		}, { threshold: [0, 0.6] })
		: null;
	const inView: Attachment<HTMLElement> = (node) => {
		observer?.observe(node);
		return () => { observer?.unobserve(node); stop(node.dataset.id!); };
	};
	$effect(() => () => observer?.disconnect());

	// The first row is on screen at once: load it eagerly at high priority. Columns come from the CSS grid (auto-fill).
	let firstRowSize = $state(2);
	const columns: Attachment<HTMLElement> = (node) => {
		firstRowSize = getComputedStyle(node).gridTemplateColumns.split(' ').length;
	};
</script>

<ul class="gallery" aria-label="Memes" aria-busy={loading} {@attach columns}>
	{#each items as item, index (item.id)}
		{@const label = item.description || item.ai_description || 'Meme'}
		{@const mediaRoute = `/api/v1/items/${item.id}/media`}
		{@const gif = item.content_type === 'image/gif'}
		{@const src = gif && playing.has(item.id) ? mediaRoute : tileSrc(item)}
		{@const firstRow = index < firstRowSize}
		<li class="tile" data-id={item.id}
			onpointerenter={gif && mouse ? () => play(item.id, true) : undefined}
			onpointerleave={gif && mouse ? () => play(item.id, false) : undefined}
			onfocusin={gif ? () => play(item.id, true) : undefined}
			onfocusout={gif ? (event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) play(item.id, false); } : undefined}
			{@attach gif ? inView : undefined}>
			<button class="tile-open" data-meme-tile onclick={() => onopen(item)} aria-label={`Open ${label}`}>
				<img {src} alt="" loading={firstRow ? 'eager' : 'lazy'} fetchpriority={firstRow ? 'high' : 'auto'} decoding="async" onload={(event) => event.currentTarget.classList.add('ready')}
					onerror={() => { if (item.thumbnail_url && src === item.thumbnail_url) onstale(item); }} />
			</button>
			<div class="tile-actions">
				{#if gif && canShareGif}
					<button class="tile-action" aria-label="Share GIF" title="Share" onclick={() => oncopy(item)}><Icon name="send" size={16} /></button>
				{:else if canCopy}
					<button class="tile-action" aria-label="Copy meme" title="Copy" onclick={() => oncopy(item)}><Icon name="copy" size={16} /></button>
				{/if}
				{#if publicLibrary || !canCopy}
					<a class="tile-action" href={`/api/v1/items/${item.id}/media?download=1`} download aria-label="Download meme" title="Download"><Icon name="download" size={16} /></a>
				{/if}
				{#if !publicLibrary && shared}
					<button class="tile-action" aria-label="Save meme" title="Save to library" onclick={() => onsave(item)}><Icon name="bookmark" size={16} /></button>
				{:else if !publicLibrary}
					<button class="tile-action" aria-label={item.favorite ? 'Unfavorite meme' : 'Favorite meme'} aria-pressed={item.favorite} title="Favorite" onclick={() => onfavorite(item)}><Icon name="heart" size={16} filled={item.favorite} /></button>
				{/if}
			</div>
			{#if gif}<span class="tile-gif" class:playing={playing.has(item.id)} aria-hidden="true">GIF</span>{/if}
			{#if item.favorite && !shared && !publicLibrary}<span class="tile-badge" aria-hidden="true"><Icon name="heart" size={12} filled /></span>{/if}
		</li>
	{/each}
	{#if loading}
		{#each { length: 12 } as _, index (index)}<li class="tile skeleton" aria-hidden="true"></li>{/each}
	{/if}
</ul>
