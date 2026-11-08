import { afterAll, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { randomUUID } from 'node:crypto';
import { createCollection, addToCollection, deleteCollection, listCollections, removeFromCollection, renameCollection } from '../src/lib/server/collections';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL must point to a test database');
const sql = new SQL(url); const owner = randomUUID(); const other = randomUUID(); const item = randomUUID();
afterAll(async () => { await sql`DELETE FROM users WHERE id IN (${owner}, ${other})`; await sql.close(); });

test('collections and their items are private to their owner', async () => {
	await sql`INSERT INTO users (id, email, password_hash) VALUES (${owner}, ${owner + '@example.com'}, 'unused'), (${other}, ${other + '@example.com'}, 'unused')`;
	await sql`INSERT INTO items (id, owner_id, content_hash, storage_key, content_type, width, height) VALUES (${item}, ${owner}, 'hash', ${'a'.repeat(64)}, 'image/png', 1, 1)`;
	const collection = await createCollection(sql, owner, 'Cats');
	await addToCollection(sql, owner, collection.id, item);
	expect((await listCollections(sql, owner)).map((entry) => entry.name)).toEqual(['Cats']);
	expect(await listCollections(sql, other)).toEqual([]);
	await expect(addToCollection(sql, other, collection.id, item)).rejects.toThrow();
	await expect(removeFromCollection(sql, other, collection.id, item)).rejects.toThrow();
	await removeFromCollection(sql, owner, collection.id, item);
	expect(await sql`SELECT item_id FROM collection_items WHERE collection_id = ${collection.id}`).toHaveLength(0);
});

test('owners can rename and delete collections without deleting items', async () => {
	const collection = await createCollection(sql, owner, 'Dogs');
	await addToCollection(sql, owner, collection.id, item);
	expect((await listCollections(sql, owner, item)).find((entry) => entry.id === collection.id)?.hasItem).toBe(true);
	await expect(renameCollection(sql, other, collection.id, 'Mine')).rejects.toThrow();
	await renameCollection(sql, owner, collection.id, 'Good dogs');
	expect((await listCollections(sql, owner)).map((entry) => entry.name)).toContain('Good dogs');
	await expect(deleteCollection(sql, other, collection.id)).rejects.toThrow();
	await deleteCollection(sql, owner, collection.id);
	expect((await listCollections(sql, owner)).map((entry) => entry.id)).not.toContain(collection.id);
	expect(await sql`SELECT id FROM items WHERE id = ${item}`).toHaveLength(1);
});
