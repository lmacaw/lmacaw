import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { Item, SourceMetadata as ClientSourceMetadata } from '$lib/types';
import type { User } from './auth';
import { many, now, one, run } from './db';
import { authMode, type Env } from './env';
import { mediaSigner } from './media-url';
import { isThumbnailType, sniffImageType } from './media-validation';
import { ftsQuery, indexItem } from './search';
import { copyObject, deleteObject, newKey, putObject } from './storage';

export type SourceMetadata = ClientSourceMetadata & { title?: string };
export type ItemDto = Item;
type InitialFields = { description: string; tags: string[]; extractedText: string | null };
export type NewItem = {
	original: File;
	thumbnail: File;
	sha256: string;
	width: number;
	height: number;
	source?: SourceMetadata | null;
	initial?: InitialFields;
	shared?: boolean;
};

type ItemRecord = {
	id: string;
	owner_id: string;
	content_hash: string;
	storage_key: string;
	thumbnail_key: string | null;
	content_type: string;
	width: number;
	height: number;
	shared: number;
	favorite: number;
	description: string;
	tags: string;
	ocr_override: string | null;
	source_metadata: string | null;
};
type ItemWithAnalysis = ItemRecord & {
	ai_description: string | null;
	extracted_text: string | null;
	suggested_tags: string | null;
	ai_state: string | null;
};
type ItemRow = {
	id: string;
	ownerId: string;
	storageKey: string;
	thumbnailKey: string | null;
	contentType: string;
	width: number;
	height: number;
	shared: boolean;
	sourceMetadata: SourceMetadata | null;
};
type CreateResult = { item: ItemRow; duplicate: boolean };
type ItemPatch = Partial<Omit<InitialFields, 'extractedText'> & {
	extractedText: string;
	shared: boolean;
	favorite: boolean;
}>;
type ListOptions = { scope?: string | null; collection?: string | null; query?: string; page?: number; cursor?: Cursor | null };
/** The (created_at, id) of the last item shown: the next page starts after it. */
export type Cursor = { createdAt: number; id: string };

export class InvalidItemError extends Error {}

export const validItemId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const pageSize = 60;
const originalLimit = 20 * 1024 * 1024;
const thumbnailLimit = 300 * 1024;

function mapRow(row: ItemRecord): ItemRow {
	return {
		id: row.id, ownerId: row.owner_id, storageKey: row.storage_key, thumbnailKey: row.thumbnail_key,
		contentType: row.content_type, width: row.width, height: row.height, shared: Boolean(row.shared),
		sourceMetadata: row.source_metadata === null ? null : JSON.parse(row.source_metadata)
	};
}

/**
 * Whose items a signed-in caller manages: their own in password mode, and every owner's (null) in
 * public mode, where the maintainers look after one shared library.
 */
export function libraryOwner(env: Pick<Env, 'AUTH_MODE'>, user: User): string | null {
	return authMode(env) === 'public' && user.isAdmin ? null : user.id;
}

/** `owner` is from libraryOwner, or undefined for an anonymous caller, who never sees favorites. */
function mapDto(owner: string | null | undefined, row: ItemWithAnalysis): ItemDto {
	return {
		id: row.id,
		content_type: row.content_type,
		width: row.width,
		height: row.height,
		shared: Boolean(row.shared),
		favorite: owner !== undefined && (owner === null || row.owner_id === owner) && Boolean(row.favorite),
		description: row.description,
		tags: JSON.parse(row.tags),
		source_metadata: row.source_metadata === null ? null : JSON.parse(row.source_metadata),
		ai_description: row.ai_description,
		extracted_text: row.extracted_text,
		suggested_tags: row.suggested_tags === null ? null : JSON.parse(row.suggested_tags),
		ai_state: row.ai_state
	};
}

const itemWithAnalysis = `
	SELECT i.*, a.description AS ai_description, a.suggested_tags,
		coalesce(i.ocr_override, a.extracted_text) AS extracted_text,
		(SELECT state FROM ai_jobs j WHERE j.item_id = i.id AND j.kind = 'image'
		 ORDER BY j.created_at DESC, j.id DESC LIMIT 1) AS ai_state
	FROM items i LEFT JOIN item_analysis a ON a.item_id = i.id
`;

export async function getItemDto(env: Env, owner: string | null, id: string): Promise<ItemDto | null> {
	const row = await one<ItemWithAnalysis>(env.DB,
		`${itemWithAnalysis} WHERE i.id = ? AND i.owner_id = coalesce(?, i.owner_id)`, id, owner);
	return row && mapDto(owner, row);
}

/** Shared items, plus the caller's library; `owner` is from libraryOwner, or undefined when anonymous. */
export async function getVisibleItem(db: D1Database, owner: string | null | undefined, id: string): Promise<ItemRow | null> {
	const row = owner === undefined
		? await one<ItemRecord>(db, 'SELECT * FROM items WHERE id = ? AND shared = 1', id)
		: await one<ItemRecord>(db, 'SELECT * FROM items WHERE id = ? AND (shared = 1 OR owner_id = coalesce(?, owner_id))', id, owner);
	return row && mapRow(row);
}

// The legacy ?page parameter uses OFFSET, so a deep page reads every row before it: cap anonymous callers at ~5,000 items.
// Cursor paging reads one page of index rows at any depth and has no cap.
export const anonPageLimit = Math.ceil(5000 / pageSize);

export const encodeCursor = ({ createdAt, id }: Cursor) => `${createdAt}_${id}`;
export function decodeCursor(value: string): Cursor | null {
	const match = /^(\d{1,16})_([0-9a-z-]{1,64})$/i.exec(value);
	return match ? { createdAt: Number(match[1]), id: match[2] } : null;
}

export async function listItems(env: Env, user: User | null, { scope, collection, query = '', page = 1, cursor = null }: ListOptions):
	Promise<{ items: ItemDto[]; hasMore: boolean; nextCursor: string | null }> {
	const filters: string[] = [];
	const params: (string | number)[] = [];
	const owner = user === null ? undefined : libraryOwner(env, user);

	if (user === null || scope === 'shared') {
		filters.push('i.shared = 1');
	} else {
		if (owner) {
			filters.push('i.owner_id = ?');
			params.push(owner);
		}
		if (scope === 'favorites') filters.push('i.favorite = 1');
		if (collection) {
			filters.push(`EXISTS (
				SELECT 1 FROM collection_items ci JOIN collections c ON c.id = ci.collection_id
				WHERE ci.item_id = i.id AND c.id = ? AND c.owner_id = ?
			)`);
			params.push(collection, user.id);
		}
	}

	const queryMatch = ftsQuery(query);
	const searchJoin = queryMatch ? 'JOIN item_search ON item_search.item_id = i.id' : '';
	if (queryMatch) {
		filters.push('item_search MATCH ?');
		params.push(queryMatch);
	}

	if (cursor) {
		// A row value seeks the (owner|shared, created_at DESC, id DESC) indexes straight to the cursor.
		filters.push('(i.created_at, i.id) < (?, ?)');
		params.push(cursor.createdAt, cursor.id);
	}

	const rows = await many<ItemWithAnalysis & { created_at: number }>(env.DB, `
		${itemWithAnalysis} ${searchJoin}
		WHERE ${filters.join(' AND ') || '1 = 1'} ORDER BY i.created_at DESC, i.id DESC LIMIT ? OFFSET ?
	`, ...params, pageSize + 1, cursor ? 0 : (page - 1) * pageSize);
	const pageRows = rows.slice(0, pageSize);
	const hasMore = rows.length > pageSize;
	const last = pageRows.at(-1);
	// The query above proved each item visible to this caller, so tiles load straight from R2 without a Worker hop per thumbnail.
	const sign = mediaSigner(env);
	const items = await Promise.all(pageRows.map(async (row) => ({
		...mapDto(owner, row),
		thumbnail_url: sign
			// No thumbnail (an old copy): the media route serves the original, so sign that with its stored type.
			? await (row.thumbnail_key ? sign(row.thumbnail_key) : sign(row.storage_key, row.content_type))
			: `/api/v1/items/${row.id}/media?size=thumbnail`
	})));
	return { items, hasMore, nextCursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null };
}

/** A Discord backup job for a new item, due at once (#52). */
export function enqueueBackupStatement(db: D1Database, itemId: string) {
	const at = now();
	return db.prepare('INSERT INTO backup_jobs (id, item_id, next_at, created_at) VALUES (?, ?, ?, ?)')
		.bind(crypto.randomUUID(), itemId, at, at);
}

export function enqueueImageStatement(db: D1Database, itemId: string, ownerId: string) {
	return db.prepare("INSERT INTO ai_jobs (id, kind, item_id, owner_id, created_at) VALUES (?, 'image', ?, ?, ?)")
		.bind(crypto.randomUUID(), itemId, ownerId, now());
}

/** Requeues the item's latest image job if it failed; false when there is none to retry. */
export async function retryImageAnalysis(db: D1Database, ownerId: string | null, itemId: string): Promise<boolean> {
	const { results } = await db.prepare(`
		UPDATE ai_jobs SET state = 'pending', attempts = 0, lease_token = NULL, lease_until = NULL
		WHERE state = 'failed' AND id = (SELECT id FROM ai_jobs WHERE item_id = ? AND kind = 'image'
			AND owner_id = coalesce(?, owner_id) ORDER BY created_at DESC, id DESC LIMIT 1)
		RETURNING id
	`).bind(itemId, ownerId).run();
	return results.length > 0;
}

async function findDuplicate(db: D1Database, ownerId: string, hash: string, source: SourceMetadata | null) {
	const row = await one<ItemRecord>(db, 'SELECT * FROM items WHERE owner_id = ? AND content_hash = ?', ownerId, hash);
	if (!row) return null;
	if (source && row.source_metadata === null) {
		const [result] = await db.batch<ItemRecord>([
			db.prepare('UPDATE items SET source_metadata = coalesce(source_metadata, ?) WHERE id = ? AND owner_id = ? RETURNING *')
				.bind(JSON.stringify(source), row.id, ownerId),
			...indexItem(db, row.id, ownerId)
		]);
		return result.results[0] ? mapRow(result.results[0]) : null;
	}
	return mapRow(row);
}

function dimensionsFit(width: number, height: number): boolean {
	return width > 0 && height > 0 && width <= 768 && height <= 768;
}

function webpDimensionsFit(bytes: Uint8Array): boolean {
	if (bytes.length < 25) return false;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const chunk = String.fromCharCode(...bytes.subarray(12, 16));
	if (chunk === 'VP8X' && bytes.length >= 30) {
		const size = (start: number) => 1 + bytes[start] + (bytes[start + 1] << 8) + (bytes[start + 2] << 16);
		return dimensionsFit(size(24), size(27));
	}
	if (chunk === 'VP8L' && bytes[20] === 0x2f) {
		const size = view.getUint32(21, true);
		return dimensionsFit((size & 0x3fff) + 1, ((size >>> 14) & 0x3fff) + 1);
	}
	if (chunk === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) {
		return dimensionsFit(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
	}
	return false;
}

function jpegDimensionsFit(bytes: Uint8Array): boolean {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let offset = 2;
	while (offset + 3 < bytes.length && bytes[offset++] === 0xff) {
		while (bytes[offset] === 0xff) offset++;
		const marker = bytes[offset++];
		if (marker === 0xda || marker === 0xd9 || offset + 2 > bytes.length) return false;
		const size = view.getUint16(offset);
		if (size < 2 || offset + size > bytes.length) return false;
		if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
			return size >= 8 && dimensionsFit(view.getUint16(offset + 5), view.getUint16(offset + 3));
		}
		offset += size;
	}
	return false;
}

function validTags(tags: unknown): tags is string[] {
	return Array.isArray(tags) && tags.length <= 30 &&
		tags.every((tag) => typeof tag === 'string' && tag.trim().length > 0 && tag.length <= 60);
}

export function isItemPatch(body: unknown): body is ItemPatch {
	if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
	const value = body as Record<string, unknown>;
	return Object.keys(value).every((key) => ['shared', 'favorite', 'description', 'tags', 'extractedText'].includes(key)) &&
		(value.shared === undefined || typeof value.shared === 'boolean') &&
		(value.favorite === undefined || typeof value.favorite === 'boolean') &&
		(value.description === undefined || (typeof value.description === 'string' && value.description.length <= 2000)) &&
		(value.extractedText === undefined || (typeof value.extractedText === 'string' && value.extractedText.length <= 4000)) &&
		(value.tags === undefined || validTags(value.tags));
}

const emptyFields: InitialFields = { description: '', tags: [], extractedText: null };

type NewRecord = Pick<ItemRecord, 'content_hash' | 'content_type' | 'width' | 'height'>;
async function storeItem(
	env: Env,
	ownerId: string,
	image: NewRecord,
	source: SourceMetadata | null,
	initial: InitialFields,
	shared: boolean,
	hasThumbnail: boolean,
	write: (key: string, thumbnailKey: string | null) => Promise<void>
): Promise<CreateResult> {
	const { DB: db, MEDIA: bucket } = env;
	const existing = await findDuplicate(db, ownerId, image.content_hash, source);
	if (existing) return { item: existing, duplicate: true };

	const id = crypto.randomUUID();
	const key = newKey();
	const thumbnailKey = hasThumbnail ? newKey() : null;
	// Queue first, so cron retries a delete that fails. The queue write may fail too; try the delete anyway.
	const discard = async () => {
		const keys = [key, thumbnailKey].filter((objectKey) => objectKey !== null);
		await queueMediaDeletions(db, keys).catch(() => {});
		await Promise.all(keys.map((objectKey) => cleanMediaKey(db, bucket, objectKey)));
	};
	try {
		await write(key, thumbnailKey);
	} catch (error) {
		await discard();
		throw error;
	}

	try {
		const [inserted] = await db.batch<ItemRecord>([
			db.prepare(`
				INSERT INTO items (id, owner_id, content_hash, storage_key, thumbnail_key,
					content_type, width, height, shared, description, tags, ocr_override, source_metadata, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *
			`).bind(id, ownerId, image.content_hash, key, thumbnailKey, image.content_type,
				image.width, image.height, Number(shared), initial.description, JSON.stringify(initial.tags), initial.extractedText,
				source ? JSON.stringify(source) : null, now()),
			enqueueImageStatement(db, id, ownerId),
			...(env.DISCORD_BACKUP_WEBHOOK_URL ? [enqueueBackupStatement(db, id)] : []),
			...indexItem(db, id)
		]);
		return { item: mapRow(inserted.results[0]), duplicate: false };
	} catch (error) {
		// A failed response can follow a committed batch. Keep media if the commit cannot be ruled out.
		const committed = await one<ItemRecord>(db, 'SELECT * FROM items WHERE id = ?', id).catch(() => undefined);
		if (committed) return { item: mapRow(committed), duplicate: false };
		if (committed === undefined) throw error;

		await discard();
		const duplicate = await findDuplicate(db, ownerId, image.content_hash, source);
		if (duplicate) return { item: duplicate, duplicate: true };
		throw error;
	}
}

export async function createItem(env: Env, ownerId: string, input: NewItem): Promise<CreateResult> {
	const { original, thumbnail, sha256, width, height, source = null, initial = emptyFields, shared = false } = input;
	if (original.size > originalLimit) throw new InvalidItemError('File too large');
	if (!/^[a-f0-9]{64}$/.test(sha256)) throw new InvalidItemError('Invalid hash');
	if (![width, height].every((value) => Number.isInteger(value) && value >= 1 && value <= 20_000)) {
		throw new InvalidItemError('Invalid dimensions');
	}
	if (!isItemPatch({ ...initial, extractedText: initial.extractedText ?? undefined })) {
		throw new InvalidItemError('Invalid request');
	}
	const contentType = sniffImageType(new Uint8Array(await original.slice(0, 16).arrayBuffer()));
	if (!contentType) throw new InvalidItemError('Unsupported image format');

	if (thumbnail.size > thumbnailLimit) throw new InvalidItemError('Invalid thumbnail');
	const header = new Uint8Array(await thumbnail.slice(0, 30).arrayBuffer());
	if (!isThumbnailType(header.subarray(0, 16))) throw new InvalidItemError('Invalid thumbnail');
	const thumbnailType = sniffImageType(header)!;
	// JPEG may have metadata segments before its dimensions. The thumbnail byte limit bounds this scan.
	const fits = thumbnailType === 'image/webp'
		? webpDimensionsFit(header)
		: jpegDimensionsFit(new Uint8Array(await thumbnail.arrayBuffer()));
	if (!fits) throw new InvalidItemError('Invalid thumbnail');

	return storeItem(env, ownerId, { content_hash: sha256, content_type: contentType, width, height },
		source, initial, shared, true, async (key, thumbnailKey) => {
			// allSettled, not all: discard() must run only after both writes stop, or a late put leaks.
			const writes = await Promise.allSettled([
				putObject(env.MEDIA, key, original.stream(), contentType, original.size),
				putObject(env.MEDIA, thumbnailKey!, thumbnail.stream(), thumbnailType, thumbnail.size)
			]);
			const failed = writes.find((result) => result.status === 'rejected');
			if (failed) throw failed.reason;
		});
}

/** `ownerId` is from libraryOwner: null updates the item whoever owns it. */
export async function updateItem(env: Env, ownerId: string | null, id: string, patch: ItemPatch): Promise<void> {
	if (!isItemPatch(patch)) throw new InvalidItemError('Invalid request');
	const db = env.DB;
	const { description, tags, extractedText, favorite, shared } = patch;
	const textChanged = description !== undefined || tags !== undefined || extractedText !== undefined;
	const statements = [
		db.prepare(`
			UPDATE items SET description = coalesce(?, description), tags = coalesce(?, tags),
				ocr_override = coalesce(?, ocr_override), favorite = coalesce(?, favorite),
				shared = coalesce(?, shared), revision = revision + ?
			WHERE id = ? AND owner_id = coalesce(?, owner_id)
			RETURNING id
		`).bind(description ?? null, tags === undefined ? null : JSON.stringify(tags), extractedText ?? null,
			favorite === undefined ? null : Number(favorite), shared === undefined ? null : Number(shared),
			Number(textChanged), id, ownerId)
	];
	if (textChanged) {
		statements.push(
			db.prepare(`DELETE FROM ai_jobs WHERE item_id = ? AND owner_id = coalesce(?, owner_id)
				AND kind = 'document' AND state IN ('pending', 'failed')`).bind(id, ownerId),
			db.prepare(`INSERT INTO ai_jobs (id, kind, item_id, owner_id, created_at)
				SELECT ?, 'document', id, owner_id, ? FROM items WHERE id = ? AND owner_id = coalesce(?, owner_id)`)
				.bind(crypto.randomUUID(), now(), id, ownerId)
		);
	}
	if (textChanged || shared !== undefined) statements.push(...indexItem(db, id, ownerId ?? undefined));
	const [updated] = await db.batch(statements);
	if (!updated.results.length) throw new Error('Item not found');
	// Milestone C synchronizes Vectorize when shared changes.
}

export async function saveSharedCopy(env: Env, userId: string, itemId: string): Promise<CreateResult> {
	const row = await one<ItemWithAnalysis>(env.DB, `
		${itemWithAnalysis} WHERE i.id = ? AND (i.owner_id = ? OR i.shared = 1)
	`, itemId, userId);
	if (!row) throw new Error('Item not found');

	const source = mapRow(row);
	const tags: string[] = JSON.parse(row.tags);
	const initial = {
		description: row.description || row.ai_description || '',
		tags: tags.length ? tags : JSON.parse(row.suggested_tags ?? '[]') as string[],
		extractedText: row.extracted_text
	};
	return storeItem(env, userId, row, source.sourceMetadata, initial, false, source.thumbnailKey !== null, async (key, thumbnailKey) => {
		await copyObject(env.MEDIA, source.storageKey, key);
		if (source.thumbnailKey && thumbnailKey) await copyObject(env.MEDIA, source.thumbnailKey, thumbnailKey);
	});
}

async function cleanMediaKey(db: D1Database, bucket: R2Bucket, key: string): Promise<void> {
	try {
		await deleteObject(bucket, key);
		await run(db, 'DELETE FROM media_deletions WHERE storage_key = ?', key);
	} catch {
		// Keep the queued key for another attempt.
	}
}

function queueMediaDeletions(db: D1Database, keys: string[]) {
	return db.batch(keys.map((key) => db.prepare(
		'INSERT INTO media_deletions (storage_key, created_at) VALUES (?, ?) ON CONFLICT(storage_key) DO NOTHING'
	).bind(key, now())));
}

/** Skips queued keys that an item still references, so a stray queue row never deletes live media. */
export async function cleanupDeletedMedia(env: Env, limit = 50): Promise<void> {
	const keys = await many<{ storage_key: string }>(env.DB, `
		SELECT storage_key FROM media_deletions d
		WHERE NOT EXISTS (SELECT 1 FROM items WHERE storage_key = d.storage_key OR thumbnail_key = d.storage_key)
		ORDER BY created_at LIMIT ?
	`, limit);
	for (const { storage_key } of keys) await cleanMediaKey(env.DB, env.MEDIA, storage_key);
}

/** `ownerId` is from libraryOwner: null deletes the item whoever owns it. */
export async function deleteItem(env: Env, ownerId: string | null, id: string): Promise<void> {
	const db = env.DB;
	const [, , deleted] = await db.batch<Pick<ItemRecord, 'storage_key' | 'thumbnail_key'>>([
		db.prepare(`
			INSERT INTO media_deletions (storage_key, created_at)
			SELECT storage_key, ? FROM items WHERE id = ? AND owner_id = coalesce(?, owner_id)
			UNION ALL
			SELECT thumbnail_key, ? FROM items WHERE id = ? AND owner_id = coalesce(?, owner_id) AND thumbnail_key IS NOT NULL
			ON CONFLICT(storage_key) DO NOTHING
		`).bind(now(), id, ownerId, now(), id, ownerId),
		db.prepare('DELETE FROM item_search WHERE item_id IN (SELECT id FROM items WHERE id = ? AND owner_id = coalesce(?, owner_id))')
			.bind(id, ownerId),
		db.prepare('DELETE FROM items WHERE id = ? AND owner_id = coalesce(?, owner_id) RETURNING storage_key, thumbnail_key')
			.bind(id, ownerId)
	]);
	const row = deleted.results[0];
	if (!row) throw new Error('Item not found');
	await Promise.all([
		cleanMediaKey(db, env.MEDIA, row.storage_key),
		row.thumbnail_key && cleanMediaKey(db, env.MEDIA, row.thumbnail_key)
	]);
}

// Openverse landing URLs among `sources` that the owner already saved (see source_metadata.source).
export async function savedSources(env: Env, ownerId: string, sources: string[]): Promise<Set<string>> {
	const rows = await many<{ source: string }>(env.DB, `
		SELECT json_extract(source_metadata, '$.source') AS source FROM items
		WHERE owner_id = ? AND json_extract(source_metadata, '$.source') IN (SELECT value FROM json_each(?))
	`, ownerId, JSON.stringify(sources.filter(Boolean)));
	return new Set(rows.map((row) => row.source));
}
