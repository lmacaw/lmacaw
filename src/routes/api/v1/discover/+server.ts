import { json } from '@sveltejs/kit';
import { getEnv } from '$lib/server/env';
import { savedSources } from '$lib/server/library';
import { searchOpenverse } from '$lib/server/openverse';
import { requireRole } from '$lib/server/request';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { url, platform } = event;
	const env = getEnv(platform);
	const caller = requireRole(event, 'member', env);
	if (caller instanceof Response) return caller;
	const query = (url.searchParams.get('q') ?? '').trim();
	if (!query || query.length > 200) return json({ error: 'Enter a search term' }, { status: 400 });
	const requested = Number(url.searchParams.get('page') ?? 1);
	const page = Number.isInteger(requested) && requested > 0 && requested <= 100 ? requested : 1;
	let items;
	try {
		items = await searchOpenverse(query, page);
	} catch {
		return json({ error: 'Search unavailable' }, { status: 502 });
	}
	const saved = await savedSources(env, caller!.id, items.map((item) => item.source));
	return json({ items: items.map((item) => ({ ...item, saved: saved.has(item.source) })) });
};
