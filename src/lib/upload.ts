import { prepareUpload } from './thumbnail';

export async function uploadFile(file: Blob, extra?: { openverse?: string; collection?: string; sha256?: string }): Promise<Response> {
	const { thumbnail, sha256, width, height } = await prepareUpload(file, extra?.sha256);
	const body = new FormData();
	body.set('file', file);
	body.set('thumbnail', thumbnail);
	body.set('sha256', sha256);
	body.set('width', String(width));
	body.set('height', String(height));
	if (extra?.openverse) body.set('openverse', extra.openverse);
	if (extra?.collection) body.set('collection', extra.collection);
	return fetch('/api/v1/items', { method: 'POST', body });
}

export async function fetchAndUpload(source: { url: string } | { openverse: string }): Promise<Response> {
	const response = await fetch(`/api/v1/fetch?${new URLSearchParams(source)}`);
	if (!response.ok) return response;
	return uploadFile(await response.blob(), 'openverse' in source ? source : undefined);
}

/** Runs `task` over `items` with at most `limit` in flight. Tasks must not throw. */
export async function eachLimit<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
	let next = 0;
	const worker = async () => { while (next < items.length) await task(items[next++]); };
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
