import type { D1Database } from '@cloudflare/workers-types';
import { many, now, one, run } from './db';

export type Collection = { id: string; name: string; hasItem?: boolean };

export function isCollectionName(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	const name = value.trim();
	return name.length >= 1 && name.length <= 80;
}

export function isCollectionNameConflict(error: unknown): boolean {
	return error instanceof Error && error.message.includes('UNIQUE constraint failed: collections.owner_id, collections.name');
}

export function isUuid(value: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function createCollection(db: D1Database, ownerId: string, value: string): Promise<{ id: string; name: string }> {
	if (!isCollectionName(value)) throw new Error('Invalid collection name');
	const name = value.trim();
	const id = crypto.randomUUID();
	await run(db, 'INSERT INTO collections (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)', id, ownerId, name, now());
	return { id, name };
}

export async function listCollections(db: D1Database, ownerId: string, itemId: string | null = null): Promise<Collection[]> {
	const rows = await many<{ id: string; name: string; has_item: number }>(db, `
		SELECT c.id, c.name, EXISTS (
			SELECT 1 FROM collection_items ci
			WHERE ci.collection_id = c.id AND ci.item_id = ?
		) AS has_item
		FROM collections c WHERE c.owner_id = ?
		ORDER BY lower(c.name), c.id
	`, itemId, ownerId);
	return rows.map(({ id, name, has_item }) => itemId ? { id, name, hasItem: Boolean(has_item) } : { id, name });
}

export async function renameCollection(db: D1Database, ownerId: string, collectionId: string, value: string): Promise<void> {
	if (!isCollectionName(value)) throw new Error('Invalid collection name');
	const row = await one(db, 'UPDATE collections SET name = ? WHERE id = ? AND owner_id = ? RETURNING id', value.trim(), collectionId, ownerId);
	if (!row) throw new Error('Collection not found');
}

export async function deleteCollection(db: D1Database, ownerId: string, collectionId: string): Promise<void> {
	const row = await one(db, 'DELETE FROM collections WHERE id = ? AND owner_id = ? RETURNING id', collectionId, ownerId);
	if (!row) throw new Error('Collection not found');
}

/** Only items in the caller's library can be collected; `itemOwner` is from libraryOwner (null: any item). */
export async function addToCollection(db: D1Database, ownerId: string, collectionId: string, itemId: string, itemOwner: string | null = ownerId): Promise<void> {
	const [insert, existing] = await db.batch([
		db.prepare(`
			INSERT INTO collection_items (collection_id, item_id)
			SELECT c.id, i.id FROM collections c CROSS JOIN items i
			WHERE c.id = ? AND c.owner_id = ? AND i.id = ? AND i.owner_id = coalesce(?, i.owner_id)
			ON CONFLICT (collection_id, item_id) DO NOTHING
		`).bind(collectionId, ownerId, itemId, itemOwner),
		db.prepare(`
			SELECT ci.item_id FROM collection_items ci
			JOIN collections c ON c.id = ci.collection_id
			JOIN items i ON i.id = ci.item_id
			WHERE c.id = ? AND c.owner_id = ? AND i.id = ? AND i.owner_id = coalesce(?, i.owner_id)
		`).bind(collectionId, ownerId, itemId, itemOwner)
	]);
	if (!insert.meta.changes && !existing.results.length) throw new Error('Collection or item not found');
}

export async function removeFromCollection(db: D1Database, ownerId: string, collectionId: string, itemId: string): Promise<void> {
	const row = await one(db, `
		DELETE FROM collection_items
		WHERE collection_id = (SELECT id FROM collections WHERE id = ? AND owner_id = ?) AND item_id = ?
		RETURNING item_id
	`, collectionId, ownerId, itemId);
	if (!row) throw new Error('Collection or item not found');
}
