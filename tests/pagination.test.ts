import { afterAll, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { randomUUID } from 'node:crypto';
import { GET } from '../src/routes/api/v1/items/+server';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL must point to a test database');
process.env.DATABASE_URL = url;
const sql = new SQL(url); const owner = randomUUID();
afterAll(async () => { await sql`DELETE FROM users WHERE id = ${owner}`; await sql.close(); });

test('large libraries can be browsed in pages', async () => {
	await sql`INSERT INTO users (id, email, password_hash) VALUES (${owner}, ${owner + '@example.com'}, 'unused')`;
	await sql`INSERT INTO items (id, owner_id, content_hash, storage_key, content_type, width, height) SELECT gen_random_uuid(), ${owner}, md5(n::text), md5(n::text) || md5(n::text), 'image/png', 1, 1 FROM generate_series(1, 205) n`;
	const locals = { user: { id: owner } };
	const first = await (await GET({ locals, url: new URL('https://example.test/api/v1/items') } as never)).json();
	const second = await (await GET({ locals, url: new URL('https://example.test/api/v1/items?page=2') } as never)).json();
	expect(first.items).toHaveLength(200); expect(first.hasMore).toBe(true);
	expect(second.items).toHaveLength(5); expect(second.hasMore).toBe(false);
	expect(new Set([...first.items, ...second.items].map((item: { id: string }) => item.id)).size).toBe(205);
});
