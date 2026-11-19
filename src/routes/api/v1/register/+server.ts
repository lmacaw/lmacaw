import { json } from '@sveltejs/kit';
import { passwordCredentials, readCredentialBody, registerWithInvitation, setSessionCookie } from '$lib/server/auth';
import { authMode, getEnv } from '$lib/server/env';
import { allowAttempt, clientAddress, trustedOrigin } from '$lib/server/request';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, url, cookies, platform }) => {
	const env = getEnv(platform);
	if (authMode(env) === 'public') return json({ error: 'Not found' }, { status: 404 });
	if (!trustedOrigin(request, url, env.ORIGIN)) return json({ error: 'Forbidden' }, { status: 403 });

	let credentials: ReturnType<typeof passwordCredentials>;
	let invitation: string;
	try {
		const body = await readCredentialBody(request);
		if (!body || typeof body !== 'object' || !('invitation' in body) || typeof body.invitation !== 'string') {
			return json({ error: 'Invalid request' }, { status: 400 });
		}
		invitation = body.invitation;
		credentials = passwordCredentials(body);
	} catch {
		return json({ error: 'Invalid request' }, { status: 400 });
	}
	if (!await allowAttempt(env.DB, `register:ip:${clientAddress(request)}`)) {
		return json({ error: 'Try again later' }, { status: 429 });
	}

	try {
		const token = await registerWithInvitation(env.DB, invitation, credentials.email, credentials.password);
		setSessionCookie(cookies, url, token);
		return new Response(null, { status: 201 });
	} catch (error) {
		if (error instanceof Error && (error.message === 'Invalid invitation' || error.message === 'Email taken')) {
			return json({ error: error.message }, { status: 400 });
		}
		throw error;
	}
};
