<script lang="ts">
	import Icon from './Icon.svelte';
	import type { Collection, Item } from '$lib/types';

	type Props = {
		item: Item | null; readonly: boolean; collections: Collection[]; message: string; aiEnabled: boolean;
		onclose: () => void; oncopy: (item: Item) => void; onupdate: (item: Item, patch: Record<string, unknown>) => void;
		ondelete: (item: Item) => void; onsave: (item: Item) => void; onretry: (item: Item) => void;
		ontogglecollection: (collection: Collection, checked: boolean) => void;
	};
	let { item, readonly, collections, message, aiEnabled, onclose, oncopy, onupdate, ondelete, onsave, onretry, ontogglecollection }: Props = $props();
	let dialog = $state<HTMLDialogElement>(undefined!);
	let description = $state(''), tags = $state(''), text = $state(''), loadedId = '';

	// Reset the form only when a different item opens, so a save does not wipe unsaved typing elsewhere.
	$effect(() => {
		if (!item) { loadedId = ''; if (dialog?.open) dialog.close(); return; }
		if (item.id !== loadedId) {
			loadedId = item.id;
			description = item.description || item.ai_description || '';
			tags = (item.tags.length ? item.tags : item.suggested_tags ?? []).join(', ');
			text = item.extracted_text ?? '';
		}
		if (!dialog.open) dialog.showModal();
	});

	function webUrl(value: string | undefined): string | undefined {
		try { const url = new URL(value ?? ''); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
	}
	function save(event: SubmitEvent) {
		event.preventDefault();
		if (!item) return;
		onupdate(item, { description, tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean), ...(text || item.extracted_text != null ? { extractedText: text } : {}) });
	}
	const aiLabel = $derived(!aiEnabled || !item ? '' : item.ai_state === 'failed' ? 'Analysis failed' : item.ai_state === 'leased' ? 'Analyzing…' : item.ai_state === 'pending' ? 'Queued for AI analysis' : '');
</script>

<dialog bind:this={dialog} class="detail-dialog" aria-label="Meme details" onclose={onclose}>
	{#if item}
		<div class="detail">
			<div class="detail-media"><img src={`/api/v1/items/${item.id}/media`} alt={item.description || item.ai_description || 'Meme'} /></div>
			<div class="detail-panel">
				<div class="detail-toolbar">
					<button class="icon-button" onclick={() => oncopy(item)} aria-label="Copy image" title="Copy image"><Icon name="copy" /></button>
					<a class="icon-button" href={`/api/v1/items/${item.id}/media`} download aria-label="Download" title="Download"><Icon name="download" /></a>
					{#if readonly}
						<button class="icon-button" onclick={() => onsave(item)} aria-label="Save to library" title="Save to library"><Icon name="bookmark" /></button>
					{:else}
						<button class="icon-button" class:on={item.favorite} aria-pressed={item.favorite} onclick={() => onupdate(item, { favorite: !item.favorite })} aria-label={item.favorite ? 'Unfavorite' : 'Favorite'} title="Favorite"><Icon name="heart" filled={item.favorite} /></button>
						<button class="icon-button" class:on={item.shared} aria-pressed={item.shared} onclick={() => onupdate(item, { shared: !item.shared })} aria-label={item.shared ? 'Unshare' : 'Share'} title={item.shared ? 'Shared with members' : 'Share with members'}><Icon name="share" /></button>
						<button class="icon-button danger" onclick={() => ondelete(item)} aria-label="Delete" title="Delete"><Icon name="trash" /></button>
					{/if}
					<span class="spacer"></span>
					<button class="icon-button" onclick={() => dialog.close()} aria-label="Close" title="Close"><Icon name="x" /></button>
				</div>
				{#if message}<p class="detail-message" role="status">{message}</p>{/if}
				{#if aiLabel}
					<p class="ai-state">{aiLabel}{#if item.ai_state === 'failed' && !readonly} <button class="text-button" onclick={() => onretry(item)}>Retry AI</button>{/if}</p>
				{/if}
				{#if readonly}
					<dl class="readonly-fields">
						{#if item.description || item.ai_description}<dt>Description</dt><dd>{item.description || item.ai_description}</dd>{/if}
						{#if item.tags.length}<dt>Tags</dt><dd>{item.tags.join(', ')}</dd>{/if}
						{#if item.extracted_text}<dt>Text in image</dt><dd>{item.extracted_text}</dd>{/if}
					</dl>
				{:else}
					<form class="fields" onsubmit={save}>
						<label class="field-label" for="description">Description</label>
						<textarea id="description" class="input" rows="3" maxlength="2000" bind:value={description}></textarea>
						<label class="field-label" for="tags">Tags</label>
						<input id="tags" class="input" placeholder="Comma separated" bind:value={tags} />
						<label class="field-label" for="image-text">Text in image</label>
						<textarea id="image-text" class="input" rows="2" maxlength="4000" bind:value={text}></textarea>
						<button class="button" type="submit">Save changes</button>
					</form>
					{#if collections.length}
						<fieldset class="collections">
							<legend class="field-label">Collections</legend>
							{#each collections as collection (collection.id)}
								<label class="check"><input type="checkbox" checked={collection.hasItem} onchange={(event) => ontogglecollection(collection, event.currentTarget.checked)} />{collection.name}</label>
							{/each}
						</fieldset>
					{/if}
				{/if}
				{#if item.source_metadata}
					{@const source = item.source_metadata}
					<section class="source" aria-label="Source">
						<h3 class="field-label">Source</h3>
						{#if source.attribution}<p>{source.attribution}</p>{/if}
						<p class="source-links">
							{#if webUrl(source.source)}<a href={webUrl(source.source)} target="_blank" rel="noreferrer">Original page</a>{/if}
							{#if webUrl(source.creatorUrl)}<a href={webUrl(source.creatorUrl)} target="_blank" rel="noreferrer">{source.creator || 'Creator'}</a>{/if}
							{#if webUrl(source.licenseUrl)}<a href={webUrl(source.licenseUrl)} target="_blank" rel="noreferrer">License {source.license?.toUpperCase()}</a>{:else if source.license}<span>License {source.license.toUpperCase()}</span>{/if}
						</p>
						<p class="hint">Verify license terms at the original source.</p>
					</section>
				{/if}
			</div>
		</div>
	{/if}
</dialog>
