import { afterAll, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createItem } from '../src/lib/server/library';
import { FileStorage } from '../src/lib/server/storage';
import { GET } from '../src/routes/api/v1/items/[id]/media/+server';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL must point to a test database');
process.env.DATABASE_URL = url;
const root = await mkdtemp(join(tmpdir(), 'lmacaw-media-api-'));
process.env.MEDIA_ROOT = root;
const sql = new SQL(url);
const owner = randomUUID(); const other = randomUUID();
afterAll(async () => { await sql`DELETE FROM users WHERE id IN (${owner}, ${other})`; await sql.close(); await rm(root, { recursive: true, force: true }); });

test('media is delivered only to authorized members', async () => {
	await sql`INSERT INTO users (id, email, password_hash) VALUES (${owner}, ${owner + '@example.com'}, 'unused'), (${other}, ${other + '@example.com'}, 'unused')`;
	const data = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).png().toBuffer();
	const created = await createItem(sql, new FileStorage(root), owner, data);
	const params = { id: created.item.id };
	const url = new URL('https://example.test/api/v1/items/x/media');
	const blocked = await GET({ params, url, locals: { user: { id: other } } } as never);
	expect(blocked.status).toBe(404);
	const allowed = await GET({ params, url, locals: { user: { id: owner } } } as never);
	expect(allowed.status).toBe(200);
	expect(allowed.headers.get('content-type')).toBe('image/png');
	expect(new Uint8Array(await allowed.arrayBuffer())).toEqual(data);
	const thumbnail = await GET({ params, url: new URL('https://example.test/api/v1/items/x/media?size=thumbnail'), locals: { user: { id: owner } } } as never);
	expect(thumbnail.headers.get('content-type')).toBe('image/webp');
	expect((await sharp(Buffer.from(await thumbnail.arrayBuffer())).metadata()).format).toBe('webp');
});
