import type { Handle } from '@sveltejs/kit';
import { authenticate } from './lib/server/auth';
import { db } from './lib/server/db';

export const handle: Handle = async ({ event, resolve }) => {
	const value = event.cookies.get('lmacaw_session');
	event.locals.user = value ? await authenticate(db(), value) : null;
	return resolve(event);
};
