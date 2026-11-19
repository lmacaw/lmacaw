import { json } from '@sveltejs/kit';
import { createLoginLink, readLoginLinkRequest } from '$lib/server/auth';
import { authMode, getEnv, mailConfigured } from '$lib/server/env';
import { mailerFromEnv } from '$lib/server/mail';
import { allowAttempt, clientAddress, trustedOrigin } from '$lib/server/request';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, url, platform }) => {
	const env = getEnv(platform);
	if (authMode(env) === 'public' || !mailConfigured(env)) return json({ error: 'Not found' }, { status: 404 });
	if (!trustedOrigin(request, url, env.ORIGIN)) return json({ error: 'Forbidden' }, { status: 403 });

	let input: Awaited<ReturnType<typeof readLoginLinkRequest>>;
	try {
		input = await readLoginLinkRequest(request);
	} catch {
		return json({ error: 'Invalid request' }, { status: 400 });
	}

	const { email, invitation } = input;
	const [ipAllowed, emailAllowed] = await Promise.all([
		allowAttempt(env.DB, `link:ip:${clientAddress(request)}`),
		allowAttempt(env.DB, `link:email:${email}`)
	]);
	if (!ipAllowed || !emailAllowed) return json({ error: 'Try again later' }, { status: 429 });

	const token = await createLoginLink(env.DB, email, invitation);
	if (token) {
		const primaryOrigin = env.ORIGIN.split(',')[0].trim();
		const link = `${primaryOrigin}/signin#${token}`;
		const text = `Open this link to sign in to Lmacaw. It works once and expires in 15 minutes.\n\n${link}\n\nIf you did not ask for it, ignore this email.`;
		// Send after responding, so the response time does not show whether the account exists.
		const sending = mailerFromEnv(env).send(email, 'Sign in to Lmacaw', text).catch(() => console.error('Unable to send sign-in link.'));
		if (platform?.ctx) platform.ctx.waitUntil(sending);
		else await sending;
	}

	return new Response(null, { status: 202 });
};
