// Appends a page of results, skipping items already shown (rows shift when items are added or removed between pages).
export function appendPage<T extends { id: string }>(items: T[], page: T[]): T[] {
	const seen = new Set(items.map((item) => item.id));
	return [...items, ...page.filter((item) => !seen.has(item.id) && seen.add(item.id))];
}

/** Applies an action to the shown items without refetching: `change` merges into the item, null removes it. */
export function updateLocal<T extends { id: string }>(items: T[], id: string, change: Partial<T> | null): T[] {
	return change === null
		? items.filter((item) => item.id !== id)
		: items.map((item) => (item.id === id ? { ...item, ...change } : item));
}

/** Whether a patch takes the item out of the view it is shown in (unfavorited in Favorites, unshared in Shared). */
export function leavesView(scope: string, patch: { favorite?: unknown; shared?: unknown }): boolean {
	return (scope === 'favorites' && patch.favorite === false) || (scope === 'shared' && patch.shared === false);
}
