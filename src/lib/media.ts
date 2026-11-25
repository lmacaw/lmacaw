import type { Item } from './types';

/** The gallery tile's image. GIF tiles use the original so they stay animated. The detail view reuses it as its cached placeholder. */
export function tileSrc(item: Pick<Item, 'id' | 'content_type'>): string {
	const route = `/api/v1/items/${item.id}/media`;
	return item.content_type === 'image/gif' ? route : `${route}?size=thumbnail`;
}
