import { env } from 'cloudflare:test';
import { expect, test, vi } from 'vitest';
import { authenticate, createInvitation, signInWithPassword, upsertAccessAdmin } from '$lib/server/auth';
import { many, run } from '$lib/server/db';
import { POST } from '../src/routes/api/v1/register/+server';
import { eventFor, user } from './fixtures';

const path = '/api/v1/register';
const password = 'a long password';
const emailAddress = () => `${crypto.randomUUID()}@example.com`;

function register(invitation: unknown, email = emailAddress(), options: { origin?: string; ip?: string } = {}) {
	const cookies = { set: vi.fn() };
	const event = eventFor(path, path, null, {
		method: 'POST',
		headers: { origin: options.origin ?? 'http://localhost:4173', 'CF-Connecting-IP': options.ip ?? crypto.randomUUID() },
		body: JSON.stringify({ invitation, email, password })
	});
	Object.assign(event, { cookies });
	return { cookies, response: POST(event) };
}

async function invite() {
	const admin = await upsertAccessAdmin(env.DB, emailAddress());
	return { admin, invitation: await createInvitation(env.DB, admin.id) };
}

test('registers a member with a password, starts a session, and rejects reuse of the invitation', async () => {
	const { invitation } = await invite();
	const email = emailAddress();
	const { response, cookies } = register(invitation, email.toUpperCase());
	expect((await response).status).toBe(201);
	const [cookie, token] = cookies.set.mock.calls[0];
	expect(cookie).toBe('lmacaw_session');
	expect(await authenticate(env.DB, token)).toMatchObject({ email, isAdmin: false });
	const nextToken = await signInWithPassword(env.DB, email, password);
	expect(nextToken).toBeTruthy();
	expect(await authenticate(env.DB, nextToken!)).toEqual(await authenticate(env.DB, token));

	const reused = register(invitation);
	const rejection = await reused.response;
	expect(rejection.status).toBe(400);
	expect(await rejection.json()).toEqual({ error: 'Invalid invitation' });
	expect(reused.cookies.set).not.toHaveBeenCalled();
});

test('creates only one member when two registrations race for one invitation', async () => {
	const { invitation } = await invite();
	const emails = [emailAddress(), emailAddress()];
	const requests = emails.map((email) => register(invitation, email));
	const responses = await Promise.all(requests.map(({ response }) => response));
	expect(responses.map(({ status }) => status).sort()).toEqual([201, 400]);
	const winner = responses.findIndex(({ status }) => status === 201);
	expect(await many(env.DB, 'SELECT email FROM users WHERE email IN (?, ?)', ...emails)).toEqual([{ email: emails[winner] }]);
	expect(requests[winner].cookies.set).toHaveBeenCalledTimes(1);
	expect(requests[1 - winner].cookies.set).not.toHaveBeenCalled();
});

test('an email conflict leaves the invitation available for another address', async () => {
	const { invitation } = await invite();
	const existing = await user();
	const duplicate = register(invitation, existing.email.toUpperCase());
	const response = await duplicate.response;
	expect(response.status).toBe(400);
	expect(await response.json()).toEqual({ error: 'Email taken' });
	expect(duplicate.cookies.set).not.toHaveBeenCalled();
	expect((await register(invitation).response).status).toBe(201);
});

test('rejects an expired invitation and invalid registration inputs', async () => {
	const { admin, invitation } = await invite();
	await run(env.DB, 'UPDATE invitations SET expires_at = ? WHERE created_by = ?', Date.now() - 1, admin.id);
	for (const request of [register(invitation), register('garbage'), register(123), register(invitation, 'invalid')]) {
		expect((await request.response).status).toBe(400);
		expect(request.cookies.set).not.toHaveBeenCalled();
	}
});

test('checks origin first and rate-limits the registration IP', async () => {
	expect((await register(123, undefined, { origin: 'https://untrusted.example' }).response).status).toBe(403);
	const { invitation } = await invite();
	const ip = crypto.randomUUID();
	await run(env.DB, 'INSERT INTO rate_limits (key, attempts, window_start) VALUES (?, 10, ?)', `register:ip:${ip}`, Date.now());
	const throttled = register(invitation, undefined, { ip });
	expect((await throttled.response).status).toBe(429);
	expect(throttled.cookies.set).not.toHaveBeenCalled();
	expect((await register(invitation).response).status).toBe(201);
});
