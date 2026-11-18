import { json } from '@sveltejs/kit';
import { addToCollection, isUuid, removeFromCollection } from '$lib/server/collections';
import { getEnv } from '$lib/server/env';
import { readJson, trustedOrigin } from '$lib/server/request';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request, url, params, platform }) => {
	const env = getEnv(platform);
	if (!trustedOrigin(request, url, env.ORIGIN)) return json({ error: 'Forbidden' }, { status: 403 });
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!isUuid(params.id)) return json({ error: 'Invalid request' }, { status: 400 });

	let body: unknown;
	try {
		body = await readJson(request);
	} catch {
		return json({ error: 'Invalid request' }, { status: 400 });
	}
	if (!body || typeof body !== 'object' || !('itemId' in body) || typeof body.itemId !== 'string' || !isUuid(body.itemId)) {
		return json({ error: 'Invalid request' }, { status: 400 });
	}

	try {
		await addToCollection(env.DB, locals.user.id, params.id.toLowerCase(), body.itemId.toLowerCase());
		return new Response(null, { status: 204 });
	} catch (error) {
		if (error instanceof Error && error.message === 'Collection or item not found') return new Response(null, { status: 404 });
		throw error;
	}
};

export const DELETE: RequestHandler = async ({ locals, request, url, params, platform }) => {
	const env = getEnv(platform);
	if (!trustedOrigin(request, url, env.ORIGIN)) return json({ error: 'Forbidden' }, { status: 403 });
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const itemId = url.searchParams.get('itemId');
	if (!isUuid(params.id) || !itemId || !isUuid(itemId)) return json({ error: 'Invalid request' }, { status: 400 });

	try {
		await removeFromCollection(env.DB, locals.user.id, params.id.toLowerCase(), itemId.toLowerCase());
		return new Response(null, { status: 204 });
	} catch (error) {
		if (error instanceof Error && error.message === 'Collection or item not found') return new Response(null, { status: 404 });
		throw error;
	}
};
