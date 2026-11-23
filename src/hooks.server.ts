import type { Handle } from '@sveltejs/kit';
import { verifyAccessToken } from '$lib/server/access';
import { authenticate, sessionCookie, upsertAccessAdmin } from '$lib/server/auth';
import { authMode } from '$lib/server/env';

export const handle: Handle = async ({ event, resolve }) => {
	const env = event.platform?.env;
	event.locals.user = null;
	if (env && authMode(env) === 'public') {
		const token = event.request.headers.get('cf-access-jwt-assertion');
		if (event.url.host === env.ADMIN_HOST && token) {
			const identity = await verifyAccessToken(token, env);
			if (identity) event.locals.user = await upsertAccessAdmin(env.DB, identity.email);
		}
	} else if (env) {
		const token = event.cookies.get(sessionCookie);
		if (token) event.locals.user = await authenticate(env.DB, token);
	}
	return resolve(event);
};
