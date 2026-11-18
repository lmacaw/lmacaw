import { json } from '@sveltejs/kit';
import { createLoginLink, readLoginLinkRequest } from '$lib/server/auth';
import { authMode, getEnv } from '$lib/server/env';
import { trustedOrigin } from '$lib/server/request';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, url, platform }) => {
	const env = getEnv(platform);
	if (authMode(env) === 'public') return json({ error: 'Not found' }, { status: 404 });
	if (!trustedOrigin(request, url, env.ORIGIN)) return json({ error: 'Forbidden' }, { status: 403 });
	if (env.DEV_ENDPOINTS !== 'on') return json({ error: 'Not found' }, { status: 404 });

	let input: Awaited<ReturnType<typeof readLoginLinkRequest>>;
	try {
		input = await readLoginLinkRequest(request);
	} catch {
		return json({ error: 'Invalid request' }, { status: 400 });
	}

	const token = await createLoginLink(env.DB, input.email, input.invitation);
	if (!token) return json({ error: 'Not found' }, { status: 404 });
	return json({ token }, { headers: { 'cache-control': 'no-store' } });
};
