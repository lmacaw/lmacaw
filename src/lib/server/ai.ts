import { randomUUID } from 'node:crypto';
import type { SQL } from 'bun';

export type Job = { id: string; kind: 'image' | 'query' | 'document'; itemId: string | null; query: string | null; text: string | null; leaseToken: string };
export type ImageResult = { description: string; extractedText: string; tags: string[]; embedding: number[]; model: string };

export async function retryItemAnalysis(sql: SQL, ownerId: string, itemId: string): Promise<void> {
	const rows = await sql`UPDATE ai_jobs SET state = 'pending', attempts = 0, lease_token = NULL, lease_until = NULL WHERE kind = 'image' AND item_id = ${itemId} AND owner_id = ${ownerId} AND state = 'failed' RETURNING id`;
	if (!rows.length) throw new Error('Failed job not found');
}

// Worker endpoints use single, self-contained statements instead of sql.begin(): they run every
// few seconds, and a transaction left open on a pooled connection once held the worker_status row
// lock until every pooled connection queued behind it (Bun 1.3.11, 2026-11-08).

export async function claimJob(sql: SQL): Promise<Job | null> {
	await sql`INSERT INTO worker_status (id, last_seen) VALUES (true, now()) ON CONFLICT (id) DO UPDATE SET last_seen = excluded.last_seen`;
	await sql`DELETE FROM ai_jobs WHERE kind = 'query' AND created_at < now() - interval '15 minutes'`;
	await sql`UPDATE ai_jobs SET state = 'failed' WHERE state = 'leased' AND lease_until < now() AND attempts >= 5`;
	const lease = randomUUID();
	const rows = await sql`UPDATE ai_jobs SET state = 'leased', lease_token = ${lease}, lease_until = now() + interval '5 minutes', attempts = attempts + 1
		WHERE id = (SELECT id FROM ai_jobs WHERE attempts < 5 AND (kind <> 'query' OR created_at > now() - interval '30 seconds') AND (state = 'pending' OR (state = 'leased' AND lease_until < now())) ORDER BY CASE WHEN kind = 'query' THEN 0 ELSE 1 END, created_at FOR UPDATE SKIP LOCKED LIMIT 1)
		RETURNING id, kind, item_id, query`;
	if (!rows.length) return null;
	let text: string | null = null;
	if (rows[0].kind === 'document') {
		// Record the revision and read the text in one statement, so both come from the same snapshot.
		const documents = await sql`UPDATE ai_jobs j SET revision = i.revision FROM items i LEFT JOIN item_analysis a ON a.item_id = i.id
			WHERE j.id = ${rows[0].id} AND i.id = j.item_id
			RETURNING concat_ws(' ', COALESCE(NULLIF(i.description, ''), a.description, ''), COALESCE(i.ocr_override, a.extracted_text, ''), array_to_string(CASE WHEN cardinality(i.tags) > 0 THEN i.tags ELSE COALESCE(a.suggested_tags, '{}') END, ' ')) AS text`;
		text = String(documents[0]?.text ?? '').trim().slice(0, 8000);
	}
	return { id: rows[0].id, kind: rows[0].kind, itemId: rows[0].item_id, query: rows[0].query, text, leaseToken: lease };
}

/** Queue a fresh search representation for an item, replacing any older request not yet in progress. */
export async function enqueueDocument(sql: SQL, itemId: string): Promise<void> {
	await sql`DELETE FROM ai_jobs WHERE item_id = ${itemId} AND kind = 'document' AND state IN ('pending', 'failed')`;
	await sql`INSERT INTO ai_jobs (id, kind, item_id, owner_id) SELECT ${randomUUID()}, 'document', id, owner_id FROM items WHERE id = ${itemId}`;
}

/** Store a document embedding unless the item was edited after the job read its text. */
export async function completeDocumentJob(sql: SQL, id: string, leaseToken: string, embedding: number[], model: string): Promise<void> {
	const vector = vectorLiteral(embedding);
	if (typeof model !== 'string' || !model || model.length > 100) throw new Error('Invalid model');
	const rows = await sql`WITH job AS (
			UPDATE ai_jobs SET state = 'complete', lease_token = NULL, lease_until = NULL WHERE id = ${id} AND kind = 'document' AND state = 'leased' AND lease_token = ${leaseToken} AND lease_until > now() RETURNING item_id, revision
		), saved AS (
			INSERT INTO item_analysis (item_id, embedding, embedding_model)
			SELECT i.id, ${vector}::text::vector, ${model} FROM job JOIN items i ON i.id = job.item_id AND i.revision = job.revision
			ON CONFLICT (item_id) DO UPDATE SET embedding = excluded.embedding, embedding_model = excluded.embedding_model, updated_at = now()
		)
		SELECT item_id FROM job`;
	if (!rows.length) throw new Error('Invalid or expired lease');
}

/** Queue document jobs for analysed items not embedded with `model` (every analysed item when null). */
export async function enqueueReindex(sql: SQL, model: string | null): Promise<number> {
	const rows = await sql`SELECT item_id FROM item_analysis WHERE ${model}::text IS NULL OR embedding IS NULL OR embedding_model <> ${model}::text`;
	for (const row of rows) await enqueueDocument(sql, row.item_id);
	return rows.length;
}

export async function renewLease(sql: SQL, id: string, token: string): Promise<boolean> {
	const rows = await sql`UPDATE ai_jobs SET lease_until = now() + interval '5 minutes' WHERE id = ${id} AND state = 'leased' AND lease_token = ${token} AND lease_until > now() RETURNING id`;
	if (rows.length) await sql`INSERT INTO worker_status (id, last_seen) VALUES (true, now()) ON CONFLICT (id) DO UPDATE SET last_seen = excluded.last_seen`;
	return rows.length > 0;
}

export async function failJob(sql: SQL, id: string, token: string): Promise<boolean> {
	const rows = await sql`UPDATE ai_jobs SET state = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END, lease_token = NULL, lease_until = NULL WHERE id = ${id} AND state = 'leased' AND lease_token = ${token} AND lease_until > now() RETURNING id`;
	return rows.length > 0;
}

export async function completeQueryJob(sql: SQL, id: string, leaseToken: string, embedding: number[], model: string): Promise<void> {
	const vector = vectorLiteral(embedding);
	if (typeof model !== 'string' || !model || model.length > 100) throw new Error('Invalid model');
	const rows = await sql`UPDATE ai_jobs SET state = 'complete', lease_token = NULL, lease_until = NULL, result_embedding = ${vector}::text::vector, result_model = ${model} WHERE id = ${id} AND kind = 'query' AND state = 'leased' AND lease_token = ${leaseToken} AND lease_until > now() RETURNING id`;
	if (!rows.length) throw new Error('Invalid or expired lease');
}

export function vectorLiteral(vector: number[]): string {
	if (!Array.isArray(vector) || vector.length !== 768 || vector.some((value) => typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Invalid embedding');
	return `[${vector.join(',')}]`;
}

export async function findSimilar(sql: SQL, userId: string, shared: boolean, vector: number[], model: string, favoriteOnly = false, collection: string | null = null): Promise<{ id: string }[]> {
	const queryVector = vectorLiteral(vector);
	const rows = shared
		? await sql`SELECT i.id FROM items i JOIN item_analysis a ON a.item_id = i.id WHERE i.shared = true AND a.embedding_model = ${model} AND a.embedding IS NOT NULL ORDER BY a.embedding <=> ${queryVector}::text::vector LIMIT 100`
		: await sql`SELECT i.id FROM items i JOIN item_analysis a ON a.item_id = i.id WHERE i.owner_id = ${userId} AND (NOT ${favoriteOnly}::boolean OR i.favorite = true) AND (${collection}::text IS NULL OR EXISTS (SELECT 1 FROM collection_items ci JOIN collections c ON c.id = ci.collection_id WHERE ci.item_id = i.id AND c.id::text = ${collection}::text AND c.owner_id = ${userId})) AND a.embedding_model = ${model} AND a.embedding IS NOT NULL ORDER BY a.embedding <=> ${queryVector}::text::vector LIMIT 100`;
	return rows.map((row: { id: string }) => ({ id: row.id }));
}

export async function requestSemanticMatches(sql: SQL, userId: string, shared: boolean, query: string, waitMs = 4000, favoriteOnly = false, collection: string | null = null): Promise<{ id: string }[] | null> {
	const online = await sql`SELECT id FROM worker_status WHERE id = true AND last_seen > now() - interval '3 minutes'`;
	if (!online.length) return null;
	const cached = await sql`SELECT result_embedding::text AS vector, result_model FROM ai_jobs WHERE owner_id = ${userId} AND kind = 'query' AND query = ${query} AND state = 'complete' AND created_at > now() - interval '5 minutes' ORDER BY created_at DESC LIMIT 1`;
	if (cached.length) return findSimilar(sql, userId, shared, JSON.parse(cached[0].vector), cached[0].result_model, favoriteOnly, collection);
	const id = randomUUID();
	await sql`INSERT INTO ai_jobs (id, kind, owner_id, query) VALUES (${id}, 'query', ${userId}, ${query})`;
	const deadline = Date.now() + waitMs;
	while (Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 200));
		const rows = await sql`SELECT state, result_embedding::text AS vector, result_model FROM ai_jobs WHERE id = ${id} AND owner_id = ${userId}`;
		if (!rows.length || rows[0].state === 'failed') return null;
		if (rows[0].state === 'complete') return findSimilar(sql, userId, shared, JSON.parse(rows[0].vector), rows[0].result_model, favoriteOnly, collection);
	}
	return null;
}

export async function completeImageJob(sql: SQL, id: string, leaseToken: string, result: ImageResult): Promise<void> {
	const embedding = vectorLiteral(result.embedding);
	if (typeof result.description !== 'string' || result.description.length > 4000 || typeof result.extractedText !== 'string' || result.extractedText.length > 4000 || !Array.isArray(result.tags) || result.tags.length > 30 || result.tags.some((tag) => typeof tag !== 'string' || tag.length > 60) || typeof result.model !== 'string' || !result.model || result.model.length > 100) throw new Error('Invalid AI result');
	const rows = await sql`WITH job AS (
			UPDATE ai_jobs SET state = 'complete', lease_token = NULL, lease_until = NULL WHERE id = ${id} AND kind = 'image' AND state = 'leased' AND lease_token = ${leaseToken} AND lease_until > now() RETURNING item_id
		), saved AS (
			INSERT INTO item_analysis (item_id, description, extracted_text, suggested_tags, embedding, embedding_model)
			SELECT item_id, ${result.description}, ${result.extractedText}, ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(result.tags)}::text::jsonb)), ${embedding}::text::vector, ${result.model} FROM job
			ON CONFLICT (item_id) DO UPDATE SET description = excluded.description, extracted_text = excluded.extracted_text, suggested_tags = excluded.suggested_tags, embedding = excluded.embedding, embedding_model = excluded.embedding_model, updated_at = now()
		)
		SELECT i.id, (i.description <> '' OR cardinality(i.tags) > 0 OR i.ocr_override IS NOT NULL) AS edited FROM job JOIN items i ON i.id = job.item_id`;
	if (!rows.length) throw new Error('Invalid or expired lease');
	// The owner's edits take precedence; re-embed them on top of the new analysis.
	if (rows[0].edited) await enqueueDocument(sql, rows[0].id);
}
