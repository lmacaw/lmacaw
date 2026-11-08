import { afterAll, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { randomUUID } from 'node:crypto';
import { GET } from '../src/routes/api/v1/items/+server';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL must point to a test database');
process.env.DATABASE_URL = url;
const sql = new SQL(url); const owner = randomUUID(); const member = randomUUID(); const id = randomUUID();
afterAll(async () => { await sql`DELETE FROM users WHERE id IN (${owner}, ${member})`; await sql.close(); });

test('shared results do not reveal the owner’s private favorite state', async () => {
	await sql`INSERT INTO users (id, email, password_hash) VALUES (${owner}, ${owner + '@example.com'}, 'unused'), (${member}, ${member + '@example.com'}, 'unused')`;
	await sql`INSERT INTO items (id, owner_id, content_hash, storage_key, content_type, width, height, favorite, shared) VALUES (${id}, ${owner}, 'hash', ${'d'.repeat(64)}, 'image/png', 1, 1, true, true)`;
	const response = await GET({ url: new URL('https://example.test/api/v1/items?scope=shared'), locals: { user: { id: member } } } as never);
	const data = await response.json();
	expect(data.items.find((item: { id: string }) => item.id === id).favorite).toBe(false);
});
