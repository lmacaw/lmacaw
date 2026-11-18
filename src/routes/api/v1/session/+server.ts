import { json } from '@sveltejs/kit';
import { logout, redeemLoginLink } from '$lib/server/auth';
import { getEnv } from '$lib/server/env';
import { readJson, trustedOrigin } from '$lib/server/request';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, url, cookies, platform }) => {
	const env = getEnv(platform);
	if (!trustedOrigin(request, url, env.ORIGIN)) return json({ error: 'Forbidden' }, { status: 403 });

	let body: unknown;
	try {
		body = await readJson(request);
	} catch {
		return json({ error: 'Invalid request' }, { status: 400 });
	}
	if (!body || typeof body !== 'object' || !('token' in body) || typeof body.token !== 'string') {
		return json({ error: 'Invalid request' }, { status: 400 });
	}

	const token = await redeemLoginLink(env.DB, body.token, env.ADMIN_EMAIL);
	if (!token) return json({ error: 'Invalid or expired link' }, { status: 400 });

	cookies.set('lmacaw_session', token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		maxAge: 30 * 86400
	});
	return new Response(null, { status: 204 });
};

export const DELETE: RequestHandler = async ({ request, url, cookies, platform }) => {
	const env = getEnv(platform);
	if (!trustedOrigin(request, url, env.ORIGIN)) return json({ error: 'Forbidden' }, { status: 403 });

	const token = cookies.get('lmacaw_session');
	if (token) await logout(env.DB, token);
	cookies.delete('lmacaw_session', { path: '/', secure: url.protocol === 'https:' });
	return new Response(null, { status: 204 });
};
