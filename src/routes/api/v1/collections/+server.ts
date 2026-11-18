import { json } from '@sveltejs/kit';
import { createCollection, isCollectionName, isCollectionNameConflict, isUuid, listCollections } from '$lib/server/collections';
import { getEnv } from '$lib/server/env';
import { readJson, trustedOrigin } from '$lib/server/request';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url, platform }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const item = url.searchParams.get('item');
	if (item && !isUuid(item)) return json({ error: 'Invalid item' }, { status: 400 });
	const collections = await listCollections(getEnv(platform).DB, locals.user.id, item?.toLowerCase());
	return json({ collections }, { headers: { 'cache-control': 'private, no-store' } });
};

export const POST: RequestHandler = async ({ locals, request, url, platform }) => {
	const env = getEnv(platform);
	if (!trustedOrigin(request, url, env.ORIGIN)) return json({ error: 'Forbidden' }, { status: 403 });
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

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
		const collection = await createCollection(env.DB, locals.user.id, body.name);
		return json({ collection }, { status: 201 });
	} catch (error) {
		if (isCollectionNameConflict(error)) return json({ error: 'Name already used' }, { status: 409 });
		return json({ error: 'Unable to create collection' }, { status: 400 });
	}
};
