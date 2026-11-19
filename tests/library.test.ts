import { env } from 'cloudflare:test';
import { beforeEach, expect, test, vi } from 'vitest';
import { cleanupDeletedMedia, createItem, deleteItem } from '$lib/server/library';
import { createTestItem, imageInput, png, unsignedEnv, user, webp, mediaKeys } from './fixtures';

let keysBefore: string[] = [];
beforeEach(async () => {
	keysBefore = await mediaKeys();
});

test('stores the image and thumbnail, inserts the image job, and indexes the item', async () => {
	const owner = await user();
	const input = imageInput({ initial: { description: 'Đồ ăn', tags: ['meme'], extractedText: 'Caption' } });
	const { item, duplicate } = await createItem(unsignedEnv, owner.id, input);
	expect(duplicate).toBe(false);
	expect(await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(item.id).first()).toMatchObject({
		owner_id: owner.id, storage_key: item.storageKey, thumbnail_key: item.thumbnailKey,
		content_hash: input.sha256, content_type: 'image/png', width: 1, height: 1, tags: '["meme"]'
	});
	const original = await env.MEDIA.get(item.storageKey);
	const thumbnail = await env.MEDIA.get(item.thumbnailKey!);
	expect(original?.httpMetadata?.contentType).toBe('image/png');
	expect(thumbnail?.httpMetadata?.contentType).toBe('image/webp');
	expect(await original?.bytes()).toEqual(png);
	expect(await thumbnail?.bytes()).toEqual(webp);
	expect(await env.DB.prepare('SELECT kind, owner_id, state FROM ai_jobs WHERE item_id = ?').bind(item.id).first())
		.toEqual({ kind: 'image', owner_id: owner.id, state: 'pending' });
	expect(await env.DB.prepare('SELECT * FROM item_search WHERE item_id = ?').bind(item.id).first())
		.toMatchObject({ item_id: item.id, owner_id: owner.id, shared: 0, body: expect.stringContaining('dồ ăn meme caption') });
});

test('deduplicates per owner without writing new media and fills source metadata once', async () => {
	const owner = await user();
	const sameHash = imageInput();
	const first = await createItem(unsignedEnv, owner.id, sameHash);
	const before = (await env.MEDIA.list()).objects.map((object) => object.key);
	const source = { title: 'Sourced meme', creator: 'An' };
	expect(await createItem(unsignedEnv, owner.id, { ...sameHash, source })).toMatchObject({
		duplicate: true, item: { id: first.item.id, sourceMetadata: source }
	});
	expect(await createItem(unsignedEnv, owner.id, { ...sameHash, source: { title: 'Other' } })).toMatchObject({
		duplicate: true, item: { id: first.item.id, sourceMetadata: source }
	});
	expect((await env.MEDIA.list()).objects.map((object) => object.key)).toEqual(before);
	expect(await env.DB.prepare('SELECT count(*) AS count FROM ai_jobs WHERE item_id = ?').bind(first.item.id).first('count')).toBe(1);
	const other = await user();
	const second = await createItem(unsignedEnv, other.id, sameHash);
	expect(second.duplicate).toBe(false);
	expect(second.item.storageKey).not.toBe(first.item.storageKey);
});

test('rejects a PDF named .png without writing media', async () => {
	const owner = await user();
	const original = new File(['%PDF-1.7'], 'fake.png', { type: 'image/png' });
	await expect(createTestItem(owner, { original })).rejects.toThrow('Unsupported image format');
	expect(await mediaKeys()).toEqual(keysBefore);
});

test('rejects a PNG thumbnail without writing media', async () => {
	const owner = await user();
	const thumbnail = new File([png], 'fake.webp', { type: 'image/webp' });
	await expect(createTestItem(owner, { thumbnail })).rejects.toThrow('Invalid thumbnail');
	expect(await mediaKeys()).toEqual(keysBefore);
});

test.each([
	{ width: 0 }, { width: 20_001 }, { height: 0 }, { height: 20_001 }, { width: 1.5 }
])('rejects out-of-range original dimensions %j', async (dimensions) => {
	const owner = await user();
	await expect(createTestItem(owner, dimensions)).rejects.toThrow('Invalid dimensions');
	expect(await mediaKeys()).toEqual(keysBefore);
});

test('rejects a thumbnail with a side above 768 pixels', async () => {
	const owner = await user();
	const oversized = webp.slice();
	new DataView(oversized.buffer).setUint16(26, 769, true);
	await expect(createTestItem(owner, { thumbnail: new File([oversized], 'wide.webp') }))
		.rejects.toThrow('Invalid thumbnail');
	expect(await mediaKeys()).toEqual(keysBefore);
});

test('cleans both uploaded objects when the D1 insert rolls back', async () => {
	const missingOwner = crypto.randomUUID();
	await expect(createItem(unsignedEnv, missingOwner, imageInput())).rejects.toThrow();
	expect(await mediaKeys()).toEqual(keysBefore);
});

test('preserves media when D1 commits and then loses the batch response', async () => {
	const owner = await user();
	const db = {
		prepare: env.DB.prepare.bind(env.DB),
		batch: async (statements: Parameters<typeof env.DB.batch>[0]) => {
			await env.DB.batch(statements);
			throw new Error('Lost batch response');
		}
	} as unknown as typeof env.DB;
	const { item, duplicate } = await createItem({ ...unsignedEnv, DB: db }, owner.id, imageInput());
	expect(duplicate).toBe(false);
	expect(await env.MEDIA.head(item.storageKey)).not.toBeNull();
	expect(await env.MEDIA.head(item.thumbnailKey!)).not.toBeNull();
});

test('deletes the row, FTS entry and both media objects', async () => {
	const owner = await user();
	const { item } = await createTestItem(owner);
	await deleteItem(unsignedEnv, owner.id, item.id);
	expect(await env.DB.prepare('SELECT id FROM items WHERE id = ?').bind(item.id).first()).toBeNull();
	expect(await env.DB.prepare('SELECT item_id FROM item_search WHERE item_id = ?').bind(item.id).first()).toBeNull();
	expect(await env.MEDIA.head(item.storageKey)).toBeNull();
	expect(await env.MEDIA.head(item.thumbnailKey!)).toBeNull();
	expect(await env.DB.prepare('SELECT storage_key FROM media_deletions').all()).toMatchObject({ results: [] });
});

test('queues media whose deletion failed and removes it on retry', async () => {
	const owner = await user();
	const { item } = await createTestItem(owner);
	const media = {
		delete: vi.fn(async (key: string) => {
			if (key === item.storageKey) throw new Error('R2 unavailable');
			await env.MEDIA.delete(key);
		})
	} as unknown as typeof env.MEDIA;
	await deleteItem({ ...unsignedEnv, MEDIA: media }, owner.id, item.id);

	expect(await env.DB.prepare('SELECT id FROM items WHERE id = ?').bind(item.id).first()).toBeNull();
	expect(await env.DB.prepare('SELECT storage_key FROM media_deletions').all())
		.toMatchObject({ results: [{ storage_key: item.storageKey }] });
	expect(await env.MEDIA.head(item.storageKey)).not.toBeNull();
	expect(await env.MEDIA.head(item.thumbnailKey!)).toBeNull();

	await cleanupDeletedMedia(unsignedEnv);
	expect(await env.MEDIA.head(item.storageKey)).toBeNull();
	expect(await env.DB.prepare('SELECT storage_key FROM media_deletions').all()).toMatchObject({ results: [] });
});
