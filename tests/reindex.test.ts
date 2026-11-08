import { afterAll, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { randomUUID } from 'node:crypto';
import { claimJob, completeDocumentJob, completeImageJob, enqueueDocument, enqueueReindex } from '../src/lib/server/ai';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL must point to a test database');
const sql = new SQL(url); const owner = randomUUID(); const item = randomUUID();
const vector = (value: number) => Array.from({ length: 768 }, (_, i) => (i === 0 ? value : 0));
afterAll(async () => { await sql`DELETE FROM users WHERE id = ${owner}`; await sql.close(); });

async function claimFor(kind: string) {
	const job = await claimJob(sql);
	if (!job || job.itemId !== item || job.kind !== kind) throw new Error(`Expected ${kind} job for test item, got ${job?.kind}`);
	return job;
}

test('edits re-embed effective metadata and stale jobs cannot overwrite newer edits', async () => {
	await sql`DELETE FROM ai_jobs WHERE state IN ('pending', 'leased')`;
	await sql`INSERT INTO users (id, email, password_hash) VALUES (${owner}, ${owner + '@example.com'}, 'unused')`;
	await sql`INSERT INTO items (id, owner_id, content_hash, storage_key, content_type, width, height) VALUES (${item}, ${owner}, 'reindex', ${'d'.repeat(64)}, 'image/png', 1, 1)`;
	const image = await claimFor('image');
	await completeImageJob(sql, image.id, image.leaseToken, { description: 'a dog', extractedText: 'woof', tags: ['dog'], embedding: vector(1), model: 'old-model' });
	expect(await claimJob(sql)).toBeNull();

	await sql`UPDATE items SET description = 'con mèo', revision = revision + 1 WHERE id = ${item}`;
	await enqueueDocument(sql, item);
	const stale = await claimFor('document');
	expect(stale.text).toBe('con mèo woof dog');

	await sql`UPDATE items SET description = 'tired cat', revision = revision + 1 WHERE id = ${item}`;
	await enqueueDocument(sql, item);
	await completeDocumentJob(sql, stale.id, stale.leaseToken, vector(2), 'new-model');
	expect((await sql`SELECT embedding_model FROM item_analysis WHERE item_id = ${item}`)[0].embedding_model).toBe('old-model');

	const fresh = await claimFor('document');
	expect(fresh.text).toBe('tired cat woof dog');
	await completeDocumentJob(sql, fresh.id, fresh.leaseToken, vector(3), 'new-model');
	const analysis = await sql`SELECT embedding_model, description FROM item_analysis WHERE item_id = ${item}`;
	expect(analysis[0]).toMatchObject({ embedding_model: 'new-model', description: 'a dog' });

	expect(await enqueueReindex(sql, 'new-model')).toBe(0);
	expect(await enqueueReindex(sql, 'newer-model')).toBeGreaterThanOrEqual(1);
	expect((await claimFor('document')).text).toBe('tired cat woof dog');
});

test('image analysis of an edited item queues a document job', async () => {
	await sql`DELETE FROM ai_jobs WHERE state IN ('pending', 'leased')`;
	await sql`UPDATE ai_jobs SET state = 'pending', attempts = 0 WHERE item_id = ${item} AND kind = 'image'`;
	const image = await claimFor('image');
	await completeImageJob(sql, image.id, image.leaseToken, { description: 'a dog', extractedText: 'woof', tags: ['dog'], embedding: vector(1), model: 'new-model' });
	expect((await claimFor('document')).text).toBe('tired cat woof dog');
});
