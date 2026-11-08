import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '../../../../../../lib/server/db';
import { getVisibleItem } from '../../../../../../lib/server/library';
import { storageFromEnv } from '../../../../../../lib/server/storage';

export const GET: RequestHandler = async ({ locals, params, url }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.id)) return new Response(null, { status: 404 });
	const item = await getVisibleItem(db(), locals.user.id, params.id);
	if (!item) return new Response(null, { status: 404 });
	const thumbnail = url.searchParams.get('size') === 'thumbnail' && item.thumbnailKey;
	const bytes = await storageFromEnv().get(thumbnail || item.storageKey);
	return new Response(bytes as BodyInit, { headers: { 'content-type': thumbnail ? 'image/webp' : item.contentType, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
};
