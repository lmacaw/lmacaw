import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { SQL } from 'bun';
import type { Storage } from './storage';
import { validateImage } from './media-validation';
import sharp from 'sharp';

export type SourceMetadata = { source: string; creator: string; creatorUrl?: string; license: string; licenseUrl?: string; attribution: string };
export type Item = { id: string; ownerId: string; storageKey: string; thumbnailKey: string | null; contentType: string; width: number; height: number; shared: boolean; sourceMetadata: SourceMetadata | null };
type CreateResult = { item: Item; duplicate: boolean };
type InitialFields = { description: string; tags: string[]; extractedText: string | null };
function mapItem(row: Record<string, unknown>): Item {
	return { id: String(row.id), ownerId: String(row.owner_id), storageKey: String(row.storage_key), thumbnailKey: row.thumbnail_key ? String(row.thumbnail_key) : null, contentType: String(row.content_type), width: Number(row.width), height: Number(row.height), shared: Boolean(row.shared), sourceMetadata: row.source_metadata as SourceMetadata | null };
}

export async function getVisibleItem(sql: SQL, userId: string, itemId: string): Promise<Item | null> {
	const rows = await sql`SELECT * FROM items WHERE id = ${itemId} AND (owner_id = ${userId} OR shared = true)`;
	return rows.length ? mapItem(rows[0]) : null;
}

async function findDuplicate(sql: SQL, userId: string, hash: string, source: SourceMetadata | null): Promise<Item | null> {
	const rows = source
		? await sql`UPDATE items SET source_metadata = COALESCE(source_metadata, ${JSON.stringify(source)}::text::jsonb) WHERE owner_id = ${userId} AND content_hash = ${hash} RETURNING *`
		: await sql`SELECT * FROM items WHERE owner_id = ${userId} AND content_hash = ${hash}`;
	return rows.length ? mapItem(rows[0]) : null;
}

export async function createItem(sql: SQL, storage: Storage, userId: string, bytes: Uint8Array, sourceMetadata: SourceMetadata | null = null, initial: InitialFields = { description: '', tags: [], extractedText: null }): Promise<CreateResult> {
	const image = await validateImage(bytes);
	const hash = createHash('sha256').update(bytes).digest('hex');
	const existing = await findDuplicate(sql, userId, hash, sourceMetadata);
	if (existing) return { item: existing, duplicate: true };
	const key = randomBytes(32).toString('hex');
	const thumbnailKey = image.contentType === 'image/gif' ? null : randomBytes(32).toString('hex');
	const thumbnail = thumbnailKey ? await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().resize(512, 512, { fit: 'cover', withoutEnlargement: true }).webp({ quality: 75 }).toBuffer() : null;
	await storage.put(key, bytes);
	try {
		if (thumbnailKey && thumbnail) await storage.put(thumbnailKey, thumbnail);
	} catch (error) {
		await storage.delete(key).catch(() => {});
		if (thumbnailKey) await storage.delete(thumbnailKey).catch(() => {});
		throw error;
	}
	const id = randomUUID();
	const rows = await sql`INSERT INTO items (id, owner_id, content_hash, storage_key, thumbnail_key, content_type, width, height, source_metadata, description, tags, ocr_override)
		VALUES (${id}, ${userId}, ${hash}, ${key}, ${thumbnailKey}, ${image.contentType}, ${image.width}, ${image.height}, ${sourceMetadata ? JSON.stringify(sourceMetadata) : null}::text::jsonb, ${initial.description}, ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(initial.tags)}::text::jsonb)), ${initial.extractedText})
		ON CONFLICT (owner_id, content_hash) DO NOTHING RETURNING *`;
	if (rows.length) return { item: mapItem(rows[0]), duplicate: false };
	await storage.delete(key);
	if (thumbnailKey) await storage.delete(thumbnailKey);
	const duplicate = await findDuplicate(sql, userId, hash, sourceMetadata);
	if (!duplicate) throw new Error('Item changed while uploading');
	return { item: duplicate, duplicate: true };
}

export async function setShared(sql: SQL, userId: string, itemId: string, shared: boolean): Promise<void> {
	const rows = await sql`UPDATE items SET shared = ${shared} WHERE id = ${itemId} AND owner_id = ${userId} RETURNING id`;
	if (!rows.length) throw new Error('Item not found');
}

export async function saveSharedCopy(sql: SQL, storage: Storage, userId: string, itemId: string): Promise<CreateResult> {
	const source = await getVisibleItem(sql, userId, itemId);
	if (!source || (!source.shared && source.ownerId !== userId)) throw new Error('Item not found');
	const rows = await sql`SELECT COALESCE(NULLIF(i.description, ''), a.description, '') AS description, CASE WHEN cardinality(i.tags) > 0 THEN i.tags ELSE COALESCE(a.suggested_tags, '{}') END AS tags, COALESCE(i.ocr_override, a.extracted_text) AS extracted_text FROM items i LEFT JOIN item_analysis a ON a.item_id = i.id WHERE i.id = ${itemId} AND (i.owner_id = ${userId} OR i.shared = true)`;
	if (!rows.length) throw new Error('Item not found');
	return createItem(sql, storage, userId, await storage.get(source.storageKey), source.sourceMetadata, { description: rows[0].description, tags: rows[0].tags, extractedText: rows[0].extracted_text });
}

export async function deleteItem(sql: SQL, storage: Storage, userId: string, itemId: string): Promise<void> {
	await sql.begin(async (tx) => {
		const rows = await tx`DELETE FROM items WHERE id = ${itemId} AND owner_id = ${userId} RETURNING storage_key, thumbnail_key`;
		if (!rows.length) throw new Error('Item not found');
		await tx`INSERT INTO media_deletions (storage_key) VALUES (${rows[0].storage_key}) ON CONFLICT DO NOTHING`;
		if (rows[0].thumbnail_key) await tx`INSERT INTO media_deletions (storage_key) VALUES (${rows[0].thumbnail_key}) ON CONFLICT DO NOTHING`;
	});
	await cleanupDeletedMedia(sql, storage);
}

export async function cleanupDeletedMedia(sql: SQL, storage: Storage): Promise<void> {
	const rows = await sql`SELECT storage_key FROM media_deletions ORDER BY created_at LIMIT 100`;
	for (const row of rows) {
		try { await storage.delete(row.storage_key); await sql`DELETE FROM media_deletions WHERE storage_key = ${row.storage_key}`; }
		catch { /* Retain the key for the next cleanup attempt. */ }
	}
}

/**
 * Delete stored objects that no item references, such as bytes left by an upload whose database
 * insert failed. Objects younger than `graceMs` are kept so in-flight uploads are never touched.
 */
export async function reconcileOrphans(sql: SQL, storage: Storage, graceMs = 24 * 60 * 60 * 1000): Promise<string[]> {
	const cutoff = Date.now() - graceMs;
	const removed: string[] = [];
	for await (const { key, modified } of storage.list()) {
		if (modified.getTime() > cutoff) continue;
		const rows = await sql`SELECT 1 FROM items WHERE storage_key = ${key} OR thumbnail_key = ${key} LIMIT 1`;
		if (rows.length) continue;
		await storage.delete(key);
		removed.push(key);
	}
	return removed;
}
