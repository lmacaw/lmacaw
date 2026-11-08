import type { SQL } from 'bun';
import { randomUUID } from 'node:crypto';

export async function createCollection(sql: SQL, ownerId: string, value: string): Promise<{ id: string; name: string }> {
	const name = value.trim();
	if (!name || name.length > 80) throw new Error('Invalid collection name');
	const id = randomUUID();
	await sql`INSERT INTO collections (id, owner_id, name) VALUES (${id}, ${ownerId}, ${name})`;
	return { id, name };
}

export type Collection = { id: string; name: string; hasItem?: boolean };

/** The owner's collections; with `itemId`, each entry also says whether it contains that item. */
export async function listCollections(sql: SQL, ownerId: string, itemId: string | null = null): Promise<Collection[]> {
	const rows = await sql`SELECT c.id, c.name, EXISTS (SELECT 1 FROM collection_items ci WHERE ci.collection_id = c.id AND ci.item_id::text = ${itemId}::text) AS has_item
		FROM collections c WHERE c.owner_id = ${ownerId} ORDER BY lower(c.name), c.id`;
	return rows.map((row: { id: string; name: string; has_item: boolean }) => (itemId ? { id: row.id, name: row.name, hasItem: row.has_item } : { id: row.id, name: row.name }));
}

export async function renameCollection(sql: SQL, ownerId: string, collectionId: string, value: string): Promise<void> {
	const name = value.trim();
	if (!name || name.length > 80) throw new Error('Invalid collection name');
	const rows = await sql`UPDATE collections SET name = ${name} WHERE id = ${collectionId} AND owner_id = ${ownerId} RETURNING id`;
	if (!rows.length) throw new Error('Collection not found');
}

/** Deletes the collection only; its items stay in the library. */
export async function deleteCollection(sql: SQL, ownerId: string, collectionId: string): Promise<void> {
	const rows = await sql`DELETE FROM collections WHERE id = ${collectionId} AND owner_id = ${ownerId} RETURNING id`;
	if (!rows.length) throw new Error('Collection not found');
}

export async function addToCollection(sql: SQL, ownerId: string, collectionId: string, itemId: string): Promise<void> {
	const rows = await sql`INSERT INTO collection_items (collection_id, item_id)
		SELECT c.id, i.id FROM collections c JOIN items i ON i.owner_id = c.owner_id
		WHERE c.id = ${collectionId} AND i.id = ${itemId} AND c.owner_id = ${ownerId}
		ON CONFLICT (collection_id, item_id) DO UPDATE SET collection_id = excluded.collection_id RETURNING item_id`;
	if (!rows.length) throw new Error('Collection or item not found');
}

export async function removeFromCollection(sql: SQL, ownerId: string, collectionId: string, itemId: string): Promise<void> {
	const rows = await sql`DELETE FROM collection_items ci USING collections c WHERE ci.collection_id = c.id AND c.owner_id = ${ownerId} AND c.id = ${collectionId} AND ci.item_id = ${itemId} RETURNING ci.item_id`;
	if (!rows.length) throw new Error('Collection or item not found');
}
