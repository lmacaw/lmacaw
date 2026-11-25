import { env } from 'cloudflare:test';
import { expect, test } from 'vitest';
import { GET } from '../src/routes/api/v1/items/+server';
import { anonPageLimit } from '$lib/server/library';
import { listEvent, publicBindings, signedBindings, user } from './fixtures';

test('lists 61 items across two pages in descending creation and ID order', async () => {
	const owner = await user();
	await env.DB.prepare(`
		WITH RECURSIVE sequence(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM sequence WHERE n < 61)
		INSERT INTO items (id, owner_id, content_hash, storage_key, content_type, width, height, created_at)
		SELECT printf('%03d', n), ?, printf('%064x', n), printf('%064x', n), 'image/png', 1, 1,
			CASE WHEN n = 1 THEN 2 ELSE 1 END FROM sequence
	`).bind(owner.id).run();

	const first = await (await GET(listEvent(owner, '?page=1'))).json();
	const second = await (await GET(listEvent(owner, '?page=2'))).json();
	const ids = Array.from({ length: 60 }, (_, i) => String(61 - i).padStart(3, '0'));
	expect(first.items.map((item: { id: string }) => item.id)).toEqual(['001', ...ids.slice(0, 59)]);
	expect(first.hasMore).toBe(true);
	expect(second.items.map((item: { id: string }) => item.id)).toEqual(['002']);
	expect(second.hasMore).toBe(false);
});

test.each(['0', '1.5', '10001', 'bad'])('rejects invalid page %s', async (page) => {
	const response = await GET(listEvent(await user(), `?page=${page}`));
	expect(response.status).toBe(400);
	expect(await response.json()).toEqual({ error: 'Invalid page' });
});

async function seed(owner: { id: string }, count: number) {
	// Ties on created_at check the id tiebreak: items n and n+1 share a timestamp.
	await env.DB.prepare(`
		WITH RECURSIVE sequence(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM sequence WHERE n < ${count})
		INSERT INTO items (id, owner_id, content_hash, storage_key, thumbnail_key, content_type, width, height, shared, description, created_at)
		SELECT printf('%s-%03d', ?, n), ?, printf('%064x', n), printf('%056x', n) || substr(lower(hex(?)), 1, 7) || 'a', printf('%056x', n) || substr(lower(hex(?)), 1, 7) || 'b', 'image/png', 1, 1, 1,
			CASE WHEN n % 2 THEN 'cat' ELSE 'dog' END, n / 2 FROM sequence
	`).bind(owner.id.slice(0, 8), owner.id, owner.id, owner.id).run();
	await env.DB.prepare(`INSERT INTO item_search (item_id, owner_id, shared, body)
		SELECT id, owner_id, shared, description FROM items WHERE owner_id = ?`).bind(owner.id).run();
}

async function walk(actor: Parameters<typeof listEvent>[0], search: string, bindings?: Parameters<typeof listEvent>[2]) {
	const ids: string[] = [];
	let cursor: string | null = null;
	for (let pages = 0; pages < 10; pages++) {
		const body: { items: { id: string }[]; hasMore: boolean; nextCursor: string | null } =
			await (await GET(listEvent(actor, `?${search}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, bindings))).json();
		ids.push(...body.items.map((item) => item.id));
		expect(body.nextCursor === null).toBe(!body.hasMore);
		if (!body.hasMore) return ids;
		cursor = body.nextCursor;
	}
	throw new Error('Did not finish');
}

test('cursor paging returns the same order as OFFSET paging, across timestamp ties, in every scope', async () => {
	const owner = await user();
	await seed(owner, 150);
	const all = await (async () => {
		const ids: string[] = [];
		for (let page = 1; page <= 3; page++) ids.push(...(await (await GET(listEvent(owner, `?page=${page}`))).json()).items.map((item: { id: string }) => item.id));
		return ids;
	})();
	expect(all).toHaveLength(150);
	expect(await walk(owner, 'scope=library')).toEqual(all);
	// Search joins item_search; half the items match.
	expect(await walk(owner, 'scope=library&q=cat')).toEqual(all.filter((id) => Number(id.slice(-3)) % 2));
	await env.DB.prepare('UPDATE items SET favorite = 1 WHERE owner_id = ? AND CAST(substr(id, -3) AS INTEGER) % 3 = 0').bind(owner.id).run();
	expect(await walk(owner, 'scope=favorites')).toEqual(all.filter((id) => Number(id.slice(-3)) % 3 === 0));
});

test('cursor paging in a collection', async () => {
	const owner = await user();
	await seed(owner, 70);
	const collection = crypto.randomUUID();
	await env.DB.batch([
		env.DB.prepare('INSERT INTO collections (id, owner_id, name, created_at) VALUES (?, ?, ?, 1)').bind(collection, owner.id, 'c'),
		env.DB.prepare('INSERT INTO collection_items (collection_id, item_id) SELECT ?, id FROM items WHERE owner_id = ? AND CAST(substr(id, -3) AS INTEGER) <= 65')
			.bind(collection, owner.id)
	]);
	const ids = await walk(owner, `collection=${collection}`);
	expect(ids).toHaveLength(65);
	expect(ids[0].endsWith('065')).toBe(true);
});

test('anonymous cursor paging has no depth cap; the legacy page cap stays', async () => {
	const owner = await user();
	await seed(owner, 61);
	const first = await (await GET(listEvent(null, `?scope=shared&page=${anonPageLimit}`, publicBindings))).json();
	expect(first).toMatchObject({ hasMore: false, nextCursor: null });
	const page = await (await GET(listEvent(null, '?scope=shared', publicBindings))).json();
	const next = await GET(listEvent(null, `?scope=shared&page=${anonPageLimit + 5}&cursor=${page.nextCursor}`, publicBindings));
	expect(next.status).toBe(200);
});

test.each(['', 'x', '1_', '_abc', '1_a b', '99999999999999999_a'])('rejects invalid cursor %j', async (cursor) => {
	const response = await GET(listEvent(await user(), `?cursor=${encodeURIComponent(cursor)}`));
	expect(response.status).toBe(400);
	expect(await response.json()).toEqual({ error: 'Invalid cursor' });
});

test('lists signed thumbnail URLs from one hourly signature, falling back to the media route without signing', async () => {
	const owner = await user();
	await seed(owner, 2);
	await env.DB.prepare('UPDATE items SET thumbnail_key = NULL WHERE id = ?').bind(`${owner.id.slice(0, 8)}-001`).run();
	const signed = (await (await GET(listEvent(owner, '', signedBindings))).json()).items;
	const [withThumbnail, original] = signed.map((item: { thumbnail_url: string }) => new URL(item.thumbnail_url));
	expect(withThumbnail.host).toBe('account.r2.cloudflarestorage.com');
	expect(withThumbnail.pathname).toMatch(/b$/);
	expect(withThumbnail.searchParams.get('response-content-type')).toBeNull();
	// No thumbnail: the original, with its stored type, as the media route would serve it.
	expect(original.pathname).toMatch(/a$/);
	expect(original.searchParams.get('response-content-type')).toBe('image/png');
	// Stable within the hour, so the browser cache reuses the bytes across list requests.
	const again = (await (await GET(listEvent(owner, '', signedBindings))).json()).items;
	expect(again.map((item: { thumbnail_url: string }) => item.thumbnail_url)).toEqual(signed.map((item: { thumbnail_url: string }) => item.thumbnail_url));

	const unsigned = (await (await GET(listEvent(owner))).json()).items;
	expect(unsigned.map((item: { id: string; thumbnail_url: string }) => item.thumbnail_url))
		.toEqual(unsigned.map((item: { id: string }) => `/api/v1/items/${item.id}/media?size=thumbnail`));
});
