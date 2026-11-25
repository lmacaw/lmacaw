import type { Item } from './types';

/** The still thumbnail every gallery tile loads first (GIFs too, until they play), so the detail view can reuse it as its cached placeholder. */
export function tileSrc(item: Pick<Item, 'id'>): string {
	return `/api/v1/items/${item.id}/media?size=thumbnail`;
}
