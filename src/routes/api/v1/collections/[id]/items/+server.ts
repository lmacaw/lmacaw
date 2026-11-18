import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '../../../../../../lib/server/db';
import { addToCollection, removeFromCollection } from '../../../../../../lib/server/collections';
import { readJson, trustedOrigin } from '../../../../../../lib/server/request';

const validId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const POST: RequestHandler = async ({ locals, request, url, params }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!trustedOrigin(request, url)) return json({ error: 'Forbidden' }, { status: 403 });
	let body: unknown;
	try { body = await readJson(request); } catch { return json({ error: 'Invalid request' }, { status: 400 }); }
	if (!validId(params.id) || !body || typeof body !== 'object' || !('itemId' in body) || typeof body.itemId !== 'string' || !validId(body.itemId)) return json({ error: 'Invalid request' }, { status: 400 });
	try { await addToCollection(db(), locals.user.id, params.id, body.itemId); return new Response(null, { status: 204 }); }
	catch (error) { if (error instanceof Error && error.message === 'Collection or item not found') return new Response(null, { status: 404 }); throw error; }
};

export const DELETE: RequestHandler = async ({ locals, request, url, params }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!trustedOrigin(request, url)) return json({ error: 'Forbidden' }, { status: 403 });
	const itemId = url.searchParams.get('itemId');
	if (!validId(params.id) || !itemId || !validId(itemId)) return json({ error: 'Invalid request' }, { status: 400 });
	try { await removeFromCollection(db(), locals.user.id, params.id, itemId); return new Response(null, { status: 204 }); }
	catch (error) { if (error instanceof Error && error.message === 'Collection or item not found') return new Response(null, { status: 404 }); throw error; }
};
