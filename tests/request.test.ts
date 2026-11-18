import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import { now, run } from '$lib/server/db';
import { allowAttempt, clientAddress, readJson, requireRole, trustedOrigin } from '$lib/server/request';

test.each([
	[undefined, true],
	['https://app.example', true],
	['https://a.example', true],
	['http://192.168.1.20:3000', true],
	['https://evil.example', false]
])('checks the trusted origin list for %s', (origin, allowed) => {
	const url = new URL('https://app.example/api/v1/session');
	const request = new Request(url, { headers: origin ? { origin } : {} });
	expect(trustedOrigin(request, url, 'https://a.example, http://192.168.1.20:3000')).toBe(allowed);
});

test('uses the Cloudflare address or the direct fallback', () => {
	const url = 'https://app.example';
	expect(clientAddress(new Request(url, { headers: { 'CF-Connecting-IP': '192.0.2.1' } }))).toBe('192.0.2.1');
	expect(clientAddress(new Request(url))).toBe('direct');
});

test('reads JSON up to 4096 bytes and rejects 4097 bytes', async () => {
	const data = 'a'.repeat(4094);
	await expect(readJson(new Request('https://app.example', { method: 'POST', body: JSON.stringify(data) }))).resolves.toBe(data);
	await expect(readJson(new Request('https://app.example', { method: 'POST', body: JSON.stringify(data + 'a') }))).rejects.toThrow('Body too large');
});

test('limits each key to ten attempts and resets expired windows', async () => {
	const key = crypto.randomUUID();
	for (let attempt = 0; attempt < 10; attempt++) {
		expect(await allowAttempt(env.DB, key)).toBe(true);
	}
	expect(await allowAttempt(env.DB, key)).toBe(false);
	expect(await allowAttempt(env.DB, crypto.randomUUID())).toBe(true);

	const expiredKey = crypto.randomUUID();
	await run(env.DB, 'INSERT INTO rate_limits (key, attempts, window_start) VALUES (?, ?, ?)', expiredKey, 11, now() - 61_000);
	expect(await allowAttempt(env.DB, expiredKey)).toBe(true);
});

describe('requireRole', () => {
	const admin = { id: 'a', email: 'a@example.com', isAdmin: true };
	const member = { id: 'm', email: 'm@example.com', isAdmin: false };
	const call = (user: typeof admin | null, role: 'anon' | 'member' | 'admin', mode?: string) =>
		requireRole({ locals: { user } }, role, { AUTH_MODE: mode });
	const status = (result: unknown) => (result instanceof Response ? result.status : 'ok');

	test.each([
		// mode, role, caller → result
		['public', 'anon', null, 'ok'], ['public', 'anon', admin, 'ok'],
		['public', 'member', null, 403], ['public', 'member', member, 403], ['public', 'member', admin, 'ok'],
		['public', 'admin', null, 403], ['public', 'admin', admin, 'ok'],
		['password', 'anon', null, 401], ['password', 'anon', member, 'ok'],
		['password', 'member', null, 401], ['password', 'member', member, 'ok'],
		['password', 'admin', member, 403], ['password', 'admin', admin, 'ok'],
		[undefined, 'member', null, 401]
	] as const)('%s mode, %s route, caller %o → %s', (mode, role, user, expected) => {
		expect(status(call(user, role, mode))).toBe(expected);
	});

	test('returns the caller, or null for an anonymous public caller', () => {
		expect(call(admin, 'admin', 'public')).toBe(admin);
		expect(call(null, 'anon', 'public')).toBeNull();
	});
});
