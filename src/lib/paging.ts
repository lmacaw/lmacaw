// Appends a page of results, skipping items already shown (rows shift when items are added or removed between pages).
export function appendPage<T extends { id: string }>(items: T[], page: T[]): T[] {
	const seen = new Set(items.map((item) => item.id));
	return [...items, ...page.filter((item) => !seen.has(item.id) && seen.add(item.id))];
}
