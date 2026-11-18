import { json } from '@sveltejs/kit';
import { searchOpenverse } from '$lib/server/openverse';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const query = (url.searchParams.get('q') ?? '').trim();
	if (!query || query.length > 200) return json({ error: 'Enter a search term' }, { status: 400 });
	const requested = Number(url.searchParams.get('page') ?? 1);
	const page = Number.isInteger(requested) && requested > 0 && requested <= 100 ? requested : 1;
	try {
		return json({ items: await searchOpenverse(query, page) });
	} catch {
		return json({ error: 'Search unavailable' }, { status: 502 });
	}
};
