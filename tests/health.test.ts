import { env } from 'cloudflare:test';
import { expect, test } from 'vitest';
import { one, run } from '$lib/server/db';
import { health } from '$lib/server/health';

test('reports healthy when the database responds', async () => {
	await expect(health(() => one(env.DB, 'SELECT 1 AS ok').then(Boolean))).resolves.toEqual({ ok: true });
});

test('reports unavailable when the database fails', async () => {
	const check = async () => {
		throw new Error('offline');
	};
	await expect(health(check)).resolves.toEqual({ ok: false });
});

test('finds indexed text in the migrated FTS5 table', async () => {
	await run(
		env.DB,
		'INSERT INTO item_search (item_id, owner_id, shared, body) VALUES (?, ?, ?, ?)',
		'item', 'owner', 0, 'do an'
	);
	const results = await env.DB.prepare('SELECT item_id, body FROM item_search WHERE item_search MATCH ?')
		.bind('do')
		.all();
	expect(results.results).toEqual([{ item_id: 'item', body: 'do an' }]);
});
