import { json } from '@sveltejs/kit';
import { createInvitation } from '$lib/server/auth';
import { authMode, getEnv } from '$lib/server/env';
import { requireRole, trustedOrigin } from '$lib/server/request';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const { request, url, platform } = event;
	const env = getEnv(platform);
	if (authMode(env) === 'public') return json({ error: 'Not found' }, { status: 404 });
	if (!trustedOrigin(request, url, env.ORIGIN)) return json({ error: 'Forbidden' }, { status: 403 });
	const caller = requireRole(event, 'admin', env);
	if (caller instanceof Response) return caller;
	if (!caller) return json({ error: 'Unauthorized' }, { status: 401 });

	const token = await createInvitation(env.DB, caller.id);
	return json({ url: `${url.origin}/invite#${token}`, token }, {
		status: 201,
		headers: { 'cache-control': 'no-store' }
	});
};
