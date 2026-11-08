import { afterAll, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { randomUUID } from 'node:crypto';
import { deleteItem, cleanupDeletedMedia, reconcileOrphans } from '../src/lib/server/library';
import type { Storage } from '../src/lib/server/storage';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL must point to a test database');
const sql = new SQL(url); const owner = randomUUID(); const item = randomUUID(); const key = 'e'.repeat(64);
afterAll(async () => { await sql`DELETE FROM media_deletions WHERE storage_key = ${key}`; await sql`DELETE FROM users WHERE id = ${owner}`; await sql.close(); });

test('failed storage deletion remains queued and can be retried', async () => {
	await sql`INSERT INTO users (id, email, password_hash) VALUES (${owner}, ${owner + '@example.com'}, 'unused')`;
	await sql`INSERT INTO items (id, owner_id, content_hash, storage_key, content_type, width, height) VALUES (${item}, ${owner}, 'hash', ${key}, 'image/png', 1, 1)`;
	let fail = true;
	const storage: Storage = { put: async () => {}, get: async () => new Uint8Array(), delete: async () => { if (fail) throw new Error('offline'); }, list: async function* () {} };
	await deleteItem(sql, storage, owner, item);
	expect(await sql`SELECT storage_key FROM media_deletions WHERE storage_key = ${key}`).toHaveLength(1);
	fail = false; await cleanupDeletedMedia(sql, storage);
	expect(await sql`SELECT storage_key FROM media_deletions WHERE storage_key = ${key}`).toHaveLength(0);
});

test('orphan reconciliation removes only old unreferenced objects', async () => {
	const referenced = 'f'.repeat(64), orphan = '1'.repeat(64), recent = '2'.repeat(64);
	const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
	await sql`INSERT INTO items (id, owner_id, content_hash, storage_key, content_type, width, height) VALUES (${randomUUID()}, ${owner}, 'orphan-test', ${referenced}, 'image/png', 1, 1)`;
	const deleted: string[] = [];
	const storage: Storage = { put: async () => {}, get: async () => new Uint8Array(), delete: async (key) => { deleted.push(key); },
		list: async function* () { yield { key: referenced, modified: old }; yield { key: orphan, modified: old }; yield { key: recent, modified: new Date() }; } };
	expect(await reconcileOrphans(sql, storage)).toEqual([orphan]);
	expect(deleted).toEqual([orphan]);
});
