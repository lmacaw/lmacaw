import { json } from '@sveltejs/kit';
import { fetchPublicImage } from '$lib/server/fetch-image';
import { getOpenverseImage } from '$lib/server/openverse';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

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
