import { afterAll, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { randomUUID } from 'node:crypto';
import { POST } from '../src/routes/api/v1/session/+server';

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL must point to a test database');
process.env.DATABASE_URL = testUrl;
const sql = new SQL(testUrl);
const id = randomUUID();
const email = `${id}@example.com`;
afterAll(async () => { await sql`DELETE FROM users WHERE id = ${id}`; await sql.close(); });

test('creates an HttpOnly session only for valid credentials', async () => {
	const passwordHash = await Bun.password.hash('a long valid password');
	await sql`INSERT INTO users (id, email, password_hash) VALUES (${id}, ${email}, ${passwordHash})`;
	let cookie: { name: string; value: string; options: Record<string, unknown> } | undefined;
	const request = new Request('https://example.test/api/v1/session', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://example.test' }, body: JSON.stringify({ email, password: 'a long valid password' }) });
	const event = { request, url: new URL(request.url), getClientAddress: () => '127.0.0.1', cookies: { set: (name: string, value: string, options: Record<string, unknown>) => { cookie = { name, value, options }; } } };
	const response = await POST(event as never);
	expect(response.status).toBe(204);
	expect(cookie?.name).toBe('lmacaw_session');
	expect(cookie?.options.httpOnly).toBe(true);
	expect(cookie?.options.secure).toBe(true);
	expect(cookie?.options.sameSite).toBe('lax');
});

test('rejects a cross-origin login request', async () => {
	const request = new Request('https://example.test/api/v1/session', { method: 'POST', headers: { origin: 'https://other.test' } });
	const response = await POST({ request, url: new URL(request.url) } as never);
	expect(response.status).toBe(403);
});

test('accepts a sign-in from an ALLOWED_ORIGINS address and sends a plain-http cookie there', async () => {
	process.env.ALLOWED_ORIGINS = 'http://192.168.1.10:47321/, https://lmacaw.lan.example';
	try {
		let cookie: { options: Record<string, unknown> } | undefined;
		const request = new Request('https://example.test/api/v1/session', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://192.168.1.10:47321' }, body: JSON.stringify({ email, password: 'a long valid password' }) });
		const event = { request, url: new URL(request.url), getClientAddress: () => '127.0.0.2', cookies: { set: (_name: string, _value: string, options: Record<string, unknown>) => { cookie = { options }; } } };
		expect((await POST(event as never)).status).toBe(204);
		expect(cookie?.options.secure).toBe(false);
		const other = new Request('https://example.test/api/v1/session', { method: 'POST', headers: { origin: 'http://192.168.1.11:47321' } });
		expect((await POST({ request: other, url: new URL(other.url) } as never)).status).toBe(403);
	} finally {
		delete process.env.ALLOWED_ORIGINS;
	}
});
