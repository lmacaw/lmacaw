import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '../../../../../lib/server/db';
import { deleteCollection, renameCollection } from '../../../../../lib/server/collections';
import { readJson } from '../../../../../lib/server/request';

const validId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export const PATCH: RequestHandler = async ({ locals, request, url, params }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const origin = request.headers.get('origin');
	if (origin && origin !== url.origin) return json({ error: 'Forbidden' }, { status: 403 });
	if (!validId(params.id)) return new Response(null, { status: 404 });
	let body: unknown;
	try { body = await readJson(request); } catch { return json({ error: 'Invalid request' }, { status: 400 }); }
	if (!body || typeof body !== 'object' || !('name' in body) || typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 80) return json({ error: 'Invalid name' }, { status: 400 });
	try { await renameCollection(db(), locals.user.id, params.id, body.name); return new Response(null, { status: 204 }); }
	catch (error) {
		if (error instanceof Error && error.message === 'Collection not found') return new Response(null, { status: 404 });
		return json({ error: 'Name already used' }, { status: 409 });
	}
};

export const DELETE: RequestHandler = async ({ locals, request, url, params }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const origin = request.headers.get('origin');
	if (origin && origin !== url.origin) return json({ error: 'Forbidden' }, { status: 403 });
	if (!validId(params.id)) return new Response(null, { status: 404 });
	try { await deleteCollection(db(), locals.user.id, params.id); return new Response(null, { status: 204 }); }
	catch { return new Response(null, { status: 404 }); }
};
