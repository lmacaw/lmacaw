import { json } from '@sveltejs/kit';
import { addToCollection, isUuid, removeFromCollection } from '$lib/server/collections';
import { getEnv } from '$lib/server/env';
import { readJson, requireRole, trustedOrigin } from '$lib/server/request';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const { request, url, params, platform } = event;
	const env = getEnv(platform);
	if (!trustedOrigin(request, url, env.ORIGIN)) return json({ error: 'Forbidden' }, { status: 403 });
	const caller = requireRole(event, 'member', env);
	if (caller instanceof Response) return caller;
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
		await addToCollection(env.DB, caller!.id, params.id.toLowerCase(), body.itemId.toLowerCase());
		return new Response(null, { status: 204 });
	} catch (error) {
		if (error instanceof Error && error.message === 'Collection or item not found') return new Response(null, { status: 404 });
		throw error;
	}
};

export const DELETE: RequestHandler = async (event) => {
	const { request, url, params, platform } = event;
	const env = getEnv(platform);
	if (!trustedOrigin(request, url, env.ORIGIN)) return json({ error: 'Forbidden' }, { status: 403 });
	const caller = requireRole(event, 'member', env);
	if (caller instanceof Response) return caller;
	const itemId = url.searchParams.get('itemId');
	if (!isUuid(params.id) || !itemId || !isUuid(itemId)) return json({ error: 'Invalid request' }, { status: 400 });

	try {
		await removeFromCollection(env.DB, caller!.id, params.id.toLowerCase(), itemId.toLowerCase());
		return new Response(null, { status: 204 });
	} catch (error) {
		if (error instanceof Error && error.message === 'Collection or item not found') return new Response(null, { status: 404 });
		throw error;
	}
};
