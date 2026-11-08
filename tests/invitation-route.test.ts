import { afterAll, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { randomUUID } from 'node:crypto';
import { POST } from '../src/routes/api/v1/invitations/+server';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL must point to a test database');
process.env.DATABASE_URL = url;
const sql = new SQL(url);
const id = randomUUID();
afterAll(async () => { await sql`DELETE FROM users WHERE id = ${id}`; await sql.close(); });

test('only an authenticated administrator can issue invitations', async () => {
	await sql`INSERT INTO users (id, email, password_hash, is_admin) VALUES (${id}, ${id + '@example.com'}, 'unused', true)`;
	const request = new Request('https://example.test/api/v1/invitations', { method: 'POST', headers: { origin: 'https://example.test' } });
	const base = { request, url: new URL(request.url) };
	const denied = await POST({ ...base, locals: { user: null } } as never);
	expect(denied.status).toBe(401);
	const allowed = await POST({ ...base, locals: { user: { id, email: id + '@example.com', isAdmin: true } } } as never);
	expect(allowed.status).toBe(201);
	expect(typeof (await allowed.json()).token).toBe('string');
});
