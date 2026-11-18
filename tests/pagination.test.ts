import { env } from 'cloudflare:test';
import { expect, test } from 'vitest';
import { GET } from '../src/routes/api/v1/items/+server';
import { listEvent, user } from './fixtures';

test('lists 201 items across two pages in descending creation and ID order', async () => {
	const owner = await user();
	await env.DB.prepare(`
		WITH RECURSIVE sequence(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM sequence WHERE n < 201)
		INSERT INTO items (id, owner_id, content_hash, storage_key, content_type, width, height, created_at)
		SELECT printf('%03d', n), ?, printf('%064x', n), printf('%064x', n), 'image/png', 1, 1,
			CASE WHEN n = 1 THEN 2 ELSE 1 END FROM sequence
	`).bind(owner.id).run();

	const first = await (await GET(listEvent(owner, '?page=1'))).json();
	const second = await (await GET(listEvent(owner, '?page=2'))).json();
	const ids = Array.from({ length: 200 }, (_, i) => String(201 - i).padStart(3, '0'));
	expect(first.items.map((item: { id: string }) => item.id)).toEqual(['001', ...ids.slice(0, 199)]);
	expect(first.hasMore).toBe(true);
	expect(second.items.map((item: { id: string }) => item.id)).toEqual(['002']);
	expect(second.hasMore).toBe(false);
});

test.each(['0', '1.5', '10001', 'bad'])('rejects invalid page %s', async (page) => {
	const response = await GET(listEvent(await user(), `?page=${page}`));
	expect(response.status).toBe(400);
	expect(await response.json()).toEqual({ error: 'Invalid page' });
});
