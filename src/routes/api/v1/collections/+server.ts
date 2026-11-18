import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '../../../../lib/server/db';
import { createCollection, listCollections } from '../../../../lib/server/collections';
import { readJson, trustedOrigin } from '../../../../lib/server/request';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const item = url.searchParams.get('item');
	if (item && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item)) return json({ error: 'Invalid item' }, { status: 400 });
	return json({ collections: await listCollections(db(), locals.user.id, item) }, { headers: { 'cache-control': 'private, no-store' } });
};

export const POST: RequestHandler = async ({ locals, request, url }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!trustedOrigin(request, url)) return json({ error: 'Forbidden' }, { status: 403 });
	let body: unknown;
	try { body = await readJson(request); } catch { return json({ error: 'Invalid request' }, { status: 400 }); }
	if (!body || typeof body !== 'object' || !('name' in body) || typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 80) return json({ error: 'Invalid name' }, { status: 400 });
	try { return json({ collection: await createCollection(db(), locals.user.id, body.name) }, { status: 201 }); }
	catch { return json({ error: 'Unable to create collection' }, { status: 400 }); }
};
