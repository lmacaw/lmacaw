import { afterAll, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createItem } from '../src/lib/server/library';
import { FileStorage } from '../src/lib/server/storage';
import { PATCH } from '../src/routes/api/v1/items/[id]/+server';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL must point to a test database');
process.env.DATABASE_URL = url;
const root = await mkdtemp(join(tmpdir(), 'lmacaw-item-api-')); process.env.MEDIA_ROOT = root;
const sql = new SQL(url); const owner = randomUUID(); const other = randomUUID();
afterAll(async () => { await sql`DELETE FROM users WHERE id IN (${owner}, ${other})`; await sql.close(); await rm(root, { recursive: true, force: true }); });

test('only the owner may edit tags, description, favorite, and sharing', async () => {
	await sql`INSERT INTO users (id, email, password_hash) VALUES (${owner}, ${owner + '@example.com'}, 'unused'), (${other}, ${other + '@example.com'}, 'unused')`;
	const data = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).png().toBuffer();
	const item = (await createItem(sql, new FileStorage(root), owner, data)).item;
	const invoke = (userId: string) => { const req = new Request(`https://example.test/api/v1/items/${item.id}`, { method: 'PATCH', headers: { origin: 'https://example.test', 'content-type': 'application/json' }, body: JSON.stringify({ shared: true, favorite: true, description: 'A meme', tags: ['cat'], extractedText: 'corrected text' }) }); return PATCH({ request: req, url: new URL(req.url), params: { id: item.id }, locals: { user: { id: userId } } } as never); };
	expect((await invoke(other)).status).toBe(404);
	expect((await invoke(owner)).status).toBe(204);
	const rows = await sql`SELECT shared, favorite, description, tags, ocr_override FROM items WHERE id = ${item.id}`;
	expect(rows[0]).toMatchObject({ shared: true, favorite: true, description: 'A meme', tags: ['cat'], ocr_override: 'corrected text' });
});
