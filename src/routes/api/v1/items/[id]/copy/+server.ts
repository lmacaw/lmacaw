import { json } from '@sveltejs/kit';
import { getEnv } from '$lib/server/env';
import { getItemDto, saveSharedCopy, validItemId } from '$lib/server/library';
import { trustedOrigin } from '$lib/server/request';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request, url, params, platform }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const env = getEnv(platform);
	if (!trustedOrigin(request, url, env.ORIGIN)) return json({ error: 'Forbidden' }, { status: 403 });
	if (!validItemId(params.id)) return new Response(null, { status: 404 });

	try {
		const { item, duplicate } = await saveSharedCopy(env, locals.user.id, params.id.toLowerCase());
		const dto = await getItemDto(env, locals.user.id, item.id);
		if (!dto) return new Response(null, { status: 404 });
		return json({ item: dto, duplicate }, {
			status: duplicate ? 200 : 201, headers: { 'cache-control': 'private, no-store' }
		});
	} catch (error) {
		if (error instanceof Error && error.message === 'Item not found') return new Response(null, { status: 404 });
		throw error;
	}
};
