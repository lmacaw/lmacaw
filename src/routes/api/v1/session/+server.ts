import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '../../../../lib/server/db';
import { login, logout } from '../../../../lib/server/auth';
import { allowAttempt, readJson, trustedOrigin, clientAddress } from '../../../../lib/server/request';

// The cookie is Secure only when the browser is on https; a plain-http LAN origin would drop it.
const overHttps = (request: Request, url: URL) => (request.headers.get('origin') ?? url.origin).startsWith('https:');

export const POST: RequestHandler = async ({ request, url, cookies, getClientAddress }) => {
	if (!trustedOrigin(request, url)) return json({ error: 'Forbidden' }, { status: 403 });
	let body: unknown;
	try { body = await readJson(request); } catch { return json({ error: 'Invalid request' }, { status: 400 }); }
	if (!body || typeof body !== 'object' || !('email' in body) || !('password' in body) || typeof body.email !== 'string' || typeof body.password !== 'string' || body.email.length > 254 || body.password.length > 1024) {
		return json({ error: 'Invalid request' }, { status: 400 });
	}
	if (!(await allowAttempt(db(), 'login', clientAddress(getClientAddress)))) return json({ error: 'Try again later' }, { status: 429 });
	const value = await login(db(), body.email, body.password);
	if (!value) return json({ error: 'Invalid credentials' }, { status: 401 });
	cookies.set('lmacaw_session', value, { path: '/', httpOnly: true, sameSite: 'lax', secure: overHttps(request, url), maxAge: 30 * 86400 });
	return new Response(null, { status: 204 });
};

export const DELETE: RequestHandler = async ({ request, url, cookies }) => {
	if (!trustedOrigin(request, url)) return json({ error: 'Forbidden' }, { status: 403 });
	const value = cookies.get('lmacaw_session');
	if (value) await logout(db(), value);
	cookies.delete('lmacaw_session', { path: '/', secure: overHttps(request, url) });
	return new Response(null, { status: 204 });
};
