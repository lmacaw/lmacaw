import { prepareUpload } from './thumbnail';

export async function uploadFile(file: Blob, extra?: { openverse?: string }): Promise<Response> {
	const { thumbnail, sha256, width, height } = await prepareUpload(file);
	const body = new FormData();
	body.set('file', file);
	body.set('thumbnail', thumbnail);
	body.set('sha256', sha256);
	body.set('width', String(width));
	body.set('height', String(height));
	if (extra?.openverse) body.set('openverse', extra.openverse);
	return fetch('/api/v1/items', { method: 'POST', body });
}

export async function fetchAndUpload(source: { url: string } | { openverse: string }): Promise<Response> {
	const response = await fetch(`/api/v1/fetch?${new URLSearchParams(source)}`);
	if (!response.ok) return response;
	return uploadFile(await response.blob(), 'openverse' in source ? source : undefined);
}
