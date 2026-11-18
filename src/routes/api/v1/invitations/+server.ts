import { json } from '@sveltejs/kit';
import { createInvitation } from '$lib/server/auth';
import { getEnv } from '$lib/server/env';
import { trustedOrigin } from '$lib/server/request';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request, url, platform }) => {
	const env = getEnv(platform);
	if (!trustedOrigin(request, url, env.ORIGIN)) return json({ error: 'Forbidden' }, { status: 403 });
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!locals.user.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });

	const token = await createInvitation(env.DB, locals.user.id);
	return json({ url: `${url.origin}/invite#${token}`, token }, {
		status: 201,
		headers: { 'cache-control': 'no-store' }
	});
};
