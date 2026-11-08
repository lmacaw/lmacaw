import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '../../../../lib/server/db';
import { login, logout } from '../../../../lib/server/auth';
import { allowAttempt, readJson } from '../../../../lib/server/request';

function sameOrigin(request: Request, url: URL): boolean {
	const origin = request.headers.get('origin');
	return !origin || origin === url.origin;
}

export const POST: RequestHandler = async ({ request, url, cookies, getClientAddress }) => {
	if (!sameOrigin(request, url)) return json({ error: 'Forbidden' }, { status: 403 });
	let body: unknown;
	try { body = await readJson(request); } catch { return json({ error: 'Invalid request' }, { status: 400 }); }
	if (!body || typeof body !== 'object' || !('email' in body) || !('password' in body) || typeof body.email !== 'string' || typeof body.password !== 'string' || body.email.length > 254 || body.password.length > 1024) {
		return json({ error: 'Invalid request' }, { status: 400 });
	}
	if (!(await allowAttempt(db(), 'login', getClientAddress()))) return json({ error: 'Try again later' }, { status: 429 });
	const value = await login(db(), body.email, body.password);
	if (!value) return json({ error: 'Invalid credentials' }, { status: 401 });
	cookies.set('lmacaw_session', value, { path: '/', httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:', maxAge: 30 * 86400 });
	return new Response(null, { status: 204 });
};

export const DELETE: RequestHandler = async ({ request, url, cookies }) => {
	if (!sameOrigin(request, url)) return json({ error: 'Forbidden' }, { status: 403 });
	const value = cookies.get('lmacaw_session');
	if (value) await logout(db(), value);
	cookies.delete('lmacaw_session', { path: '/' });
	return new Response(null, { status: 204 });
};
