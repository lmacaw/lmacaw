import { afterAll, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { FileStorage } from '../src/lib/server/storage';
import { createItem, getVisibleItem, setShared, saveSharedCopy, deleteItem } from '../src/lib/server/library';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL must point to a test database');
const sql = new SQL(url);
const root = await mkdtemp(join(tmpdir(), 'lmacaw-library-test-'));
const storage = new FileStorage(root);
const owner = randomUUID();
const member = randomUUID();
afterAll(async () => { await sql`DELETE FROM users WHERE id IN (${owner}, ${member})`; await sql.close(); await rm(root, { recursive: true, force: true }); });

test('private items are isolated and saved shared copies survive deletion', async () => {
	await sql`INSERT INTO users (id, email, password_hash) VALUES (${owner}, ${owner + '@example.com'}, 'unused'), (${member}, ${member + '@example.com'}, 'unused')`;
	const data = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#cd2d51' } }).png().toBuffer();
	const metadata = { source: 'https://example.test/image', creator: 'Author', license: 'by', attribution: 'Author' };
	const first = await createItem(sql, storage, owner, data, metadata);
	const duplicate = await createItem(sql, storage, owner, data);
	expect(duplicate.duplicate).toBe(true);
	expect(duplicate.item.id).toBe(first.item.id);
	expect(await getVisibleItem(sql, member, first.item.id)).toBeNull();
	await setShared(sql, owner, first.item.id, true);
	await sql`UPDATE items SET description = 'Sleeping cat', tags = ARRAY['cat'], ocr_override = 'hello' WHERE id = ${first.item.id}`;
	expect(await getVisibleItem(sql, member, first.item.id)).not.toBeNull();
	const copy = await saveSharedCopy(sql, storage, member, first.item.id);
	await deleteItem(sql, storage, owner, first.item.id);
	const saved = await getVisibleItem(sql, member, copy.item.id);
	expect(saved).not.toBeNull();
	expect(saved?.sourceMetadata).toEqual(metadata);
	const copiedDetails = await sql`SELECT description, tags, ocr_override FROM items WHERE id = ${copy.item.id}`;
	expect(copiedDetails[0]).toMatchObject({ description: 'Sleeping cat', tags: ['cat'], ocr_override: 'hello' });
	expect(await storage.get(saved!.storageKey)).toEqual(data);
});

test('a discovered duplicate adds missing source attribution', async () => {
	await sql`INSERT INTO users (id, email, password_hash) VALUES (${owner}, ${owner + '@example.com'}, 'unused') ON CONFLICT DO NOTHING`;
	const data = await sharp({ create: { width: 3, height: 3, channels: 3, background: '#392451' } }).png().toBuffer();
	await createItem(sql, storage, owner, data);
	const metadata = { source: 'https://example.test/image', creator: 'Author', license: 'by', attribution: 'Author' };
	const duplicate = await createItem(sql, storage, owner, data, metadata);
	expect(duplicate.duplicate).toBe(true);
	expect(duplicate.item.sourceMetadata).toEqual(metadata);
});

test('retains media if the database commits but the insert response is lost', async () => {
	await sql`INSERT INTO users (id, email, password_hash) VALUES (${owner}, ${owner + '@example.com'}, 'unused') ON CONFLICT DO NOTHING`;
	const data = await sharp({ create: { width: 9, height: 9, channels: 3, background: '#145a32' } }).png().toBuffer();
	const unreliable = ((strings: TemplateStringsArray, ...values: unknown[]) => {
		const query = sql(strings, ...values);
		return strings.join('?').includes('INSERT INTO items') ? Promise.resolve(query).then(() => { throw new Error('response lost'); }) : query;
	}) as unknown as SQL;
	await expect(createItem(unreliable, storage, owner, data)).rejects.toThrow('response lost');
	const rows = await sql`SELECT storage_key, thumbnail_key FROM items WHERE owner_id = ${owner} AND width = 9`;
	expect(rows).toHaveLength(1);
	expect(await storage.get(rows[0].storage_key)).toEqual(data);
	expect((await storage.get(rows[0].thumbnail_key)).length).toBeGreaterThan(0);
});

test('thumbnails follow EXIF orientation from phone photos', async () => {
	// A landscape 40x20 sensor image tagged "rotate 90°" displays as portrait 20x40.
	const photo = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#2d6acd' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
	const { item } = await createItem(sql, storage, owner, photo);
	expect({ width: item.width, height: item.height }).toEqual({ width: 20, height: 40 });
	if (!item.thumbnailKey) throw new Error('Missing thumbnail');
	const thumbnail = await sharp(await storage.get(item.thumbnailKey)).metadata();
	expect(thumbnail.width! < thumbnail.height!).toBe(true);
});
