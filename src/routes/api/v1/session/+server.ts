import { json } from '@sveltejs/kit';
import {
	allowSignInAttempt, logout, passwordCredentials, readCredentialBody, redeemLoginLink, sessionCookie,
	setSessionCookie, signInWithPassword
} from '$lib/server/auth';
import { authMode, getEnv, mailConfigured } from '$lib/server/env';
import { trustedOrigin } from '$lib/server/request';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, url, cookies, platform }) => {
	const env = getEnv(platform);
	if (authMode(env) === 'public') return json({ error: 'Not found' }, { status: 404 });
	if (!trustedOrigin(request, url, env.ORIGIN)) return json({ error: 'Forbidden' }, { status: 403 });

	let body: unknown;
	try {
		body = await readCredentialBody(request);
	} catch {
		return json({ error: 'Invalid request' }, { status: 400 });
	}
	if (body && typeof body === 'object' && 'token' in body) {
		// Links come from mail, or from the dev endpoint in local development and browser tests.
		const linksEnabled = mailConfigured(env) || env.DEV_ENDPOINTS === 'on';
		if (!linksEnabled || typeof body.token !== 'string' || 'email' in body || 'password' in body) {
			return json({ error: 'Invalid request' }, { status: 400 });
		}
		const token = await redeemLoginLink(env.DB, body.token);
		if (!token) return json({ error: 'Invalid or expired link' }, { status: 400 });
		setSessionCookie(cookies, url, token);
		return new Response(null, { status: 204 });
	}

	let credentials: ReturnType<typeof passwordCredentials>;
	try {
		credentials = passwordCredentials(body);
	} catch {
		return json({ error: 'Invalid request' }, { status: 400 });
	}
	const { email, password } = credentials;
	if (!await allowSignInAttempt(env.DB, request, email)) {
		return json({ error: 'Try again later' }, { status: 429 });
	}
	const token = await signInWithPassword(env.DB, email, password);
	if (!token) return json({ error: 'Unauthorized' }, { status: 401 });

	setSessionCookie(cookies, url, token);
	return new Response(null, { status: 204 });
};

export const DELETE: RequestHandler = async ({ request, url, cookies, platform }) => {
	const env = getEnv(platform);
	if (authMode(env) === 'public') return json({ error: 'Not found' }, { status: 404 });
	if (!trustedOrigin(request, url, env.ORIGIN)) return json({ error: 'Forbidden' }, { status: 403 });

	const token = cookies.get(sessionCookie);
	if (token) await logout(env.DB, token);
	cookies.delete(sessionCookie, { path: '/', secure: url.protocol === 'https:' });
	return new Response(null, { status: 204 });
};
