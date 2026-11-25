<script lang="ts">
	import Icon from './Icon.svelte';
	import { tileSrc } from '$lib/media';
	import type { Item } from '$lib/types';

	type Props = { items: Item[]; canCopy: boolean; shared: boolean; publicLibrary: boolean; onopen: (item: Item) => void; oncopy: (item: Item) => void; onfavorite: (item: Item) => void; onsave: (item: Item) => void };
	let { items, canCopy, shared, publicLibrary, onopen, oncopy, onfavorite, onsave }: Props = $props();
</script>

<ul class="gallery" aria-label="Memes">
	{#each items as item (item.id)}
		{@const label = item.description || item.ai_description || 'Meme'}
		<li class="tile">
			<button class="tile-open" data-meme-tile onclick={() => onopen(item)} aria-label={`Open ${label}`}>
				<img src={tileSrc(item)} alt="" loading="lazy" decoding="async" />
			</button>
			<div class="tile-actions">
				{#if canCopy}
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
			{#if item.favorite && !shared && !publicLibrary}<span class="tile-badge" aria-hidden="true"><Icon name="heart" size={12} filled /></span>{/if}
		</li>
	{/each}
</ul>
