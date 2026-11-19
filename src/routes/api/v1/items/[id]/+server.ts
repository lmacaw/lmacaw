import { json } from '@sveltejs/kit';
import { getEnv } from '$lib/server/env';
import { deleteItem, isItemPatch, updateItem, validItemId } from '$lib/server/library';
import { readJson, requireRole, trustedOrigin } from '$lib/server/request';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async (event) => {
	const { request, url, params, platform } = event;
	const env = getEnv(platform);
	if (!trustedOrigin(request, url, env.ORIGIN)) return json({ error: 'Forbidden' }, { status: 403 });
	const caller = requireRole(event, 'member', env);
	if (caller instanceof Response) return caller;
	if (!validItemId(params.id)) return new Response(null, { status: 404 });

	let body: unknown;
	try {
		body = await readJson(request, 64 * 1024);
	} catch {
		return json({ error: 'Invalid request' }, { status: 400 });
	}
	if (!isItemPatch(body)) return json({ error: 'Invalid request' }, { status: 400 });

	try {
		await updateItem(env, caller!.id, params.id.toLowerCase(), body);
	} catch (error) {
		if (error instanceof Error && error.message === 'Item not found') return new Response(null, { status: 404 });
		throw error;
	}
	return new Response(null, { status: 204 });
};

export const DELETE: RequestHandler = async (event) => {
	const { request, url, params, platform } = event;
	const env = getEnv(platform);
	if (!trustedOrigin(request, url, env.ORIGIN)) return json({ error: 'Forbidden' }, { status: 403 });
	const caller = requireRole(event, 'member', env);
	if (caller instanceof Response) return caller;
	if (!validItemId(params.id)) return new Response(null, { status: 404 });

	try {
		await deleteItem(env, caller!.id, params.id.toLowerCase());
	} catch (error) {
		if (error instanceof Error && error.message === 'Item not found') return new Response(null, { status: 404 });
		throw error;
	}
	return new Response(null, { status: 204 });
};
