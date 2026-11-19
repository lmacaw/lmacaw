import { env } from 'cloudflare:test';
import { expect, test, vi } from 'vitest';
import { authenticate, upsertAccessAdmin } from '$lib/server/auth';
import { one, run } from '$lib/server/db';
import { POST } from '../src/routes/api/v1/setup/+server';
import { eventFor } from './fixtures';

const path = '/api/v1/setup';
const email = 'admin@example.com';
const password = 'a long password';

function setup(body: unknown = { email, password }, options: { adminEmail?: string | null; origin?: string; ip?: string } = {}) {
	const cookies = { set: vi.fn() };
	const event = eventFor(path, path, null, {
		method: 'POST',
		headers: { origin: options.origin ?? 'http://localhost:4173', 'CF-Connecting-IP': options.ip ?? crypto.randomUUID() },
		body: JSON.stringify(body)
	}, undefined, { ADMIN_EMAIL: options.adminEmail === null ? undefined : options.adminEmail ?? email });
	Object.assign(event, { cookies });
	return { cookies, response: POST(event) };
}

test('sets up the first administrator once even when setup requests overlap', async () => {
	const requests = [setup({ email: email.toUpperCase(), password }), setup()];
	const responses = await Promise.all(requests.map(({ response }) => response));
	expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
	const winner = responses.findIndex(({ status }) => status === 201);
	const [cookie, token] = requests[winner].cookies.set.mock.calls[0];
	expect(cookie).toBe('lmacaw_session');
	expect(await authenticate(env.DB, token)).toMatchObject({ email, isAdmin: true });
	expect(requests[1 - winner].cookies.set).not.toHaveBeenCalled();
	expect(await one(env.DB, 'SELECT COUNT(*) AS count FROM users')).toEqual({ count: 1 });
	expect(await one(env.DB, 'SELECT COUNT(*) AS count FROM sessions')).toEqual({ count: 1 });
	expect((await setup().response).status).toBe(409);
});

test('returns 409 if a user already exists at another email', async () => {
	await upsertAccessAdmin(env.DB, 'another@example.com');
	const { cookies, response } = setup({ email: 'new-admin@example.com', password }, { adminEmail: 'new-admin@example.com' });
	expect((await response).status).toBe(409);
	expect(cookies.set).not.toHaveBeenCalled();
});

test('forbids a mismatched or missing ADMIN_EMAIL binding', async () => {
	const requests = [setup({ email: 'other@example.com', password }), setup(undefined, { adminEmail: null })];
	for (const { response, cookies } of requests) {
		expect((await response).status).toBe(403);
		expect(cookies.set).not.toHaveBeenCalled();
	}
});

test('checks the origin before parsing setup credentials', async () => {
	expect((await setup({}, { origin: 'https://untrusted.example' }).response).status).toBe(403);
	expect((await setup({ email, password: 'too short' }).response).status).toBe(400);
});

test('setup uses the sign-in IP and email rate limits', async () => {
	const address = 'limited@example.com';
	const ip = crypto.randomUUID();
	for (const key of [`signin:ip:${ip}`, `signin:email:${address}`]) {
		await run(env.DB, 'INSERT INTO rate_limits (key, attempts, window_start) VALUES (?, 10, ?)', key, Date.now());
	}
	expect((await setup({ email, password }, { ip }).response).status).toBe(429);
	expect((await setup({ email: address, password }, { adminEmail: address }).response).status).toBe(429);
});
