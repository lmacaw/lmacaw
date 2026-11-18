import type { Handle } from '@sveltejs/kit';
import { authenticate } from '$lib/server/auth';
import { getEnv } from '$lib/server/env';

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get('lmacaw_session');
	event.locals.user = token && event.platform?.env
		? await authenticate(getEnv(event.platform).DB, token)
		: null;
	return resolve(event);
};
