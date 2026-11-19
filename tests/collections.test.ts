import { env } from 'cloudflare:test';
import { beforeEach, expect, test } from 'vitest';
import { addToCollection, createCollection, deleteCollection, listCollections, removeFromCollection, renameCollection } from '$lib/server/collections';

const db = env.DB;
let owner: string;
let other: string;
let item: string;

beforeEach(async () => {
	owner = crypto.randomUUID();
	other = crypto.randomUUID();
	item = crypto.randomUUID();
	await db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, 0), (?, ?, 0)')
		.bind(owner, `${owner}@example.com`, other, `${other}@example.com`).run();
});

async function insertItem(id: string, ownerId: string, shared = 0) {
	await db.prepare(`
		INSERT INTO items (id, owner_id, content_hash, storage_key, content_type, width, height, shared, created_at)
		VALUES (?, ?, ?, ?, 'image/png', 1, 1, ?, 0)
	`).bind(id, ownerId, id, id, shared).run();
}

test('lists only the owner’s collections in case-insensitive name order with optional membership', async () => {
	await insertItem(item, owner);
	const cats = await createCollection(db, owner, ' Cats ');
	const dogs = await createCollection(db, owner, 'dogs');
	const birds = await createCollection(db, owner, 'birds');
	const otherCats = await createCollection(db, other, 'Cats');
	await addToCollection(db, owner, cats.id, item);

	expect(cats.name).toBe('Cats');
	expect(await listCollections(db, owner)).toEqual([birds, cats, dogs]);
	expect(await listCollections(db, owner, item)).toEqual([
		{ ...birds, hasItem: false }, { ...cats, hasItem: true }, { ...dogs, hasItem: false }
	]);
	expect(await listCollections(db, other, item)).toEqual([{ ...otherCats, hasItem: false }]);
	await expect(addToCollection(db, other, cats.id, item)).rejects.toThrow('Collection or item not found');
	await expect(removeFromCollection(db, other, cats.id, item)).rejects.toThrow('Collection or item not found');

	await removeFromCollection(db, owner, cats.id, item);
	expect(await db.prepare('SELECT item_id FROM collection_items WHERE collection_id = ?').bind(cats.id).first()).toBeNull();
	await expect(removeFromCollection(db, owner, cats.id, item)).rejects.toThrow('Collection or item not found');
});

test('allows shared items and idempotent adds while rejecting missing or private items', async () => {
	const shared = crypto.randomUUID();
	await insertItem(item, other);
	await insertItem(shared, other, 1);
	const collection = await createCollection(db, owner, 'Cats');

	await expect(addToCollection(db, owner, collection.id, item)).rejects.toThrow('Collection or item not found');
	await expect(addToCollection(db, owner, collection.id, crypto.randomUUID())).rejects.toThrow('Collection or item not found');
	await addToCollection(db, owner, collection.id, shared);
	await addToCollection(db, owner, collection.id, shared);
	const rows = await db.prepare('SELECT item_id FROM collection_items WHERE collection_id = ?').bind(collection.id).all();
	expect(rows.results).toEqual([{ item_id: shared }]);

	await db.prepare('UPDATE items SET shared = 0 WHERE id = ?').bind(shared).run();
	await expect(addToCollection(db, owner, collection.id, shared)).rejects.toThrow('Collection or item not found');
	await removeFromCollection(db, owner, collection.id, shared);
});

test('only owners can rename and delete collections, and deletion preserves items', async () => {
	await insertItem(item, owner);
	const collection = await createCollection(db, owner, 'Dogs');
	await addToCollection(db, owner, collection.id, item);
	await expect(renameCollection(db, other, collection.id, 'Mine')).rejects.toThrow('Collection not found');
	await renameCollection(db, owner, collection.id, ' Good dogs ');
	expect(await listCollections(db, owner, item)).toEqual([{ ...collection, name: 'Good dogs', hasItem: true }]);
	await expect(deleteCollection(db, other, collection.id)).rejects.toThrow('Collection not found');
	await deleteCollection(db, owner, collection.id);
	expect(await listCollections(db, owner)).toEqual([]);
	expect(await db.prepare('SELECT id FROM items WHERE id = ?').bind(item).first()).toEqual({ id: item });
	expect(await db.prepare('SELECT item_id FROM collection_items WHERE collection_id = ?').bind(collection.id).first()).toBeNull();
});

test.each(['', '   ', 'a'.repeat(81)])('validates collection names (%j)', async (name) => {
	await expect(createCollection(db, owner, name)).rejects.toThrow('Invalid collection name');
	const collection = await createCollection(db, owner, 'a'.repeat(80));
	await expect(renameCollection(db, owner, collection.id, name)).rejects.toThrow('Invalid collection name');
});
