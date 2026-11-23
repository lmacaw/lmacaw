import { json } from '@sveltejs/kit';
import {
	allowSignInAttempt, passwordCredentials, readCredentialBody, setSessionCookie, setupFirstAdmin
} from '$lib/server/auth';
import { authMode, getEnv } from '$lib/server/env';
import { trustedOrigin } from '$lib/server/request';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, url, cookies, platform }) => {
	const env = getEnv(platform);
	if (authMode(env) === 'public') return json({ error: 'Not found' }, { status: 404 });
	if (!trustedOrigin(request, url, env.ORIGIN)) return json({ error: 'Forbidden' }, { status: 403 });

	let credentials: ReturnType<typeof passwordCredentials>;
	try {
		credentials = passwordCredentials(await readCredentialBody(request));
	} catch {
		return json({ error: 'Invalid request' }, { status: 400 });
	}
	const { email, password } = credentials;
	if (!await allowSignInAttempt(env.DB, request, email)) {
		return json({ error: 'Try again later' }, { status: 429 });
	}

	try {
		const token = await setupFirstAdmin(env.DB, email, password, env.ADMIN_EMAIL);
		setSessionCookie(cookies, url, token);
		return new Response(null, { status: 201 });
	} catch (error) {
		if (error instanceof Error) {
			if (error.message === 'Forbidden') return json({ error: error.message }, { status: 403 });
			if (error.message === 'Already set up') return json({ error: error.message }, { status: 409 });
		}
		throw error;
	}
};
