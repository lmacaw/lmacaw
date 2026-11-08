import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { redeemInvitation } from '../../../../lib/server/auth';
import { db } from '../../../../lib/server/db';
import { allowAttempt, readJson } from '../../../../lib/server/request';

export const POST: RequestHandler = async ({ request, url, getClientAddress }) => {
	const origin = request.headers.get('origin');
	if (origin && origin !== url.origin) return json({ error: 'Forbidden' }, { status: 403 });
	let body: unknown;
	try { body = await readJson(request); } catch { return json({ error: 'Invalid request' }, { status: 400 }); }
	if (!body || typeof body !== 'object' || !('token' in body) || !('email' in body) || !('password' in body) || typeof body.token !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(body.token) || typeof body.email !== 'string' || typeof body.password !== 'string') {
		return json({ error: 'Invalid request' }, { status: 400 });
	}
	if (!(await allowAttempt(db(), 'register', getClientAddress()))) return json({ error: 'Try again later' }, { status: 429 });
	try {
		await redeemInvitation(db(), body.token, body.email, body.password);
		return new Response(null, { status: 201 });
	} catch {
		return json({ error: 'Unable to register' }, { status: 400 });
	}
};
