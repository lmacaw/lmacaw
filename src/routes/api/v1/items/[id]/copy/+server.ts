import { json } from '@sveltejs/kit';
import { getEnv } from '$lib/server/env';
import { getItemDto, saveSharedCopy, validItemId } from '$lib/server/library';
import { requireRole, trustedOrigin } from '$lib/server/request';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const { request, url, params, platform } = event;
	const env = getEnv(platform);
	if (!trustedOrigin(request, url, env.ORIGIN)) return json({ error: 'Forbidden' }, { status: 403 });
	const caller = requireRole(event, 'member', env);
	if (caller instanceof Response) return caller;
	if (!validItemId(params.id)) return new Response(null, { status: 404 });

	try {
		const { item, duplicate } = await saveSharedCopy(env, caller!.id, params.id.toLowerCase());
		const dto = await getItemDto(env, caller!.id, item.id);
		if (!dto) return new Response(null, { status: 404 });
		return json({ item: dto, duplicate }, {
			status: duplicate ? 200 : 201, headers: { 'cache-control': 'private, no-store' }
		});
	} catch (error) {
		if (error instanceof Error && error.message === 'Item not found') return new Response(null, { status: 404 });
		throw error;
	}
};
