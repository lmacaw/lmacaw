import { afterAll, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createItem, setShared } from '../src/lib/server/library';
import { FileStorage } from '../src/lib/server/storage';
import { POST } from '../src/routes/api/v1/items/[id]/copy/+server';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL must point to a test database');
process.env.DATABASE_URL = url;
const root = await mkdtemp(join(tmpdir(), 'lmacaw-copy-api-')); process.env.MEDIA_ROOT = root;
const sql = new SQL(url); const owner = randomUUID(); const other = randomUUID();
afterAll(async () => { await sql`DELETE FROM users WHERE id IN (${owner}, ${other})`; await sql.close(); await rm(root, { recursive: true, force: true }); });

test('only shared items can be copied to another library', async () => {
	await sql`INSERT INTO users (id, email, password_hash) VALUES (${owner}, ${owner + '@example.com'}, 'unused'), (${other}, ${other + '@example.com'}, 'unused')`;
	const data = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).png().toBuffer();
	const item = (await createItem(sql, new FileStorage(root), owner, data)).item;
	const invoke = () => { const request = new Request('https://example.test/api/v1/items/copy', { method: 'POST', headers: { origin: 'https://example.test' } }); return POST({ request, url: new URL(request.url), params: { id: item.id }, locals: { user: { id: other } } } as never); };
	expect((await invoke()).status).toBe(404);
	await setShared(sql, owner, item.id, true);
	const response = await invoke();
	expect(response.status).toBe(201);
	expect((await response.json()).item.storageKey).toBeUndefined();
});
