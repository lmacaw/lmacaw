import { json } from '@sveltejs/kit';
import { deleteCollection, isCollectionName, isCollectionNameConflict, isUuid, renameCollection } from '$lib/server/collections';
import { getEnv } from '$lib/server/env';
import { readJson, trustedOrigin } from '$lib/server/request';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ locals, request, url, params, platform }) => {
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
	if (!body || typeof body !== 'object' || !('name' in body) || !isCollectionName(body.name)) {
		return json({ error: 'Invalid name' }, { status: 400 });
	}

	try {
		await renameCollection(env.DB, locals.user.id, params.id.toLowerCase(), body.name);
		return new Response(null, { status: 204 });
	} catch (error) {
		if (error instanceof Error && error.message === 'Collection not found') return new Response(null, { status: 404 });
		if (isCollectionNameConflict(error)) return json({ error: 'Name already used' }, { status: 409 });
		throw error;
	}
};

export const DELETE: RequestHandler = async ({ locals, request, url, params, platform }) => {
	const env = getEnv(platform);
	if (!trustedOrigin(request, url, env.ORIGIN)) return json({ error: 'Forbidden' }, { status: 403 });
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!isUuid(params.id)) return json({ error: 'Invalid request' }, { status: 400 });

	try {
		await deleteCollection(env.DB, locals.user.id, params.id.toLowerCase());
		return new Response(null, { status: 204 });
	} catch (error) {
		if (error instanceof Error && error.message === 'Collection not found') return new Response(null, { status: 404 });
		throw error;
	}
};
