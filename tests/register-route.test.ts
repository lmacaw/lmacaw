import { afterAll, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { randomUUID } from 'node:crypto';
import { createInvitation, login } from '../src/lib/server/auth';
import { POST } from '../src/routes/api/v1/register/+server';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL must point to a test database');
process.env.DATABASE_URL = url;
const sql = new SQL(url);
const id = randomUUID(); const email = `${id}@example.com`;
afterAll(async () => { await sql`DELETE FROM users WHERE id = ${id} OR email = ${email}`; await sql.close(); });

test('registers with a valid invitation once', async () => {
	await sql`INSERT INTO users (id, email, password_hash, is_admin) VALUES (${id}, ${id + '-admin@example.com'}, 'unused', true)`;
	const token = await createInvitation(sql, id);
	const request = () => new Request('https://example.test/api/v1/register', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://example.test' }, body: JSON.stringify({ token, email, password: 'a long member password' }) });
	const invoke = () => { const req = request(); return POST({ request: req, url: new URL(req.url), getClientAddress: () => '127.0.0.3' } as never); };
	expect((await invoke()).status).toBe(201);
	expect(await login(sql, email, 'a long member password')).not.toBeNull();
	expect((await invoke()).status).toBe(400);
});
