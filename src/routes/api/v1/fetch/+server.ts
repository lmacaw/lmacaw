import { json } from '@sveltejs/kit';
import { getEnv } from '$lib/server/env';
import { fetchPublicImage } from '$lib/server/fetch-image';
import { getOpenverseImage } from '$lib/server/openverse';
import { requireRole } from '$lib/server/request';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { url, platform } = event;
	const env = getEnv(platform);
	const caller = requireRole(event, 'member', env);
	if (caller instanceof Response) return caller;

	const source = url.searchParams.get('url');
	const openverse = url.searchParams.get('openverse');

	try {
		if (openverse !== null && source === null) {
			const image = await getOpenverseImage(openverse);
			return await fetchPublicImage(image.imageUrl);
		}
		if (openverse === null && source?.trim() && source.length <= 2048) {
			return await fetchPublicImage(source);
		}
		return json({ error: 'Invalid URL' }, { status: 400 });
	} catch (error) {
		if (error instanceof Error && error.message === 'Invalid image') {
			return json({ error: 'Invalid image' }, { status: 400 });
		}
		return json({ error: 'Unable to import image' }, { status: 400 });
	}
};
