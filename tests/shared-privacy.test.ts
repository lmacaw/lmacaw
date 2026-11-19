import { env } from 'cloudflare:test';
import { expect, test } from 'vitest';
import type { User } from '$lib/server/auth';
import { updateItem } from '$lib/server/library';
import { GET } from '../src/routes/api/v1/items/+server';
import { createTestItem, listEvent, unsignedEnv, user } from './fixtures';

async function listing(actor: User, query: string) {
	const response = await GET(listEvent(actor, query));
	expect(response.status).toBe(200);
	return (await response.json()).items as { id: string; favorite: boolean }[];
}

test('respects library, favorites, shared and owned collection scopes', async () => {
	const owner = await user();
	const other = await user();
	const { item: privateItem } = await createTestItem(owner);
	const { item: sharedItem } = await createTestItem(owner);
	const { item: otherItem } = await createTestItem(other);
	await updateItem(unsignedEnv, owner.id, sharedItem.id, { shared: true, favorite: true });
	await updateItem(unsignedEnv, other.id, otherItem.id, { shared: true, favorite: true });

	const collection = crypto.randomUUID();
	const foreignCollection = crypto.randomUUID();
	await env.DB.batch([
		env.DB.prepare('INSERT INTO collections (id, owner_id, name, created_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)')
			.bind(collection, owner.id, 'My collection', 1, foreignCollection, other.id, 'Foreign collection', 1),
		env.DB.prepare('INSERT INTO collection_items (collection_id, item_id) VALUES (?, ?), (?, ?), (?, ?)')
			.bind(collection, privateItem.id, collection, otherItem.id, foreignCollection, sharedItem.id)
	]);

	expect((await listing(owner, '?scope=library')).map(({ id }) => id).sort()).toEqual([privateItem.id, sharedItem.id].sort());
	expect((await listing(owner, '?scope=favorites')).map(({ id }) => id)).toEqual([sharedItem.id]);
	expect((await listing(owner, `?scope=collection&collection=${collection}`)).map(({ id }) => id)).toEqual([privateItem.id]);
	expect(await listing(owner, `?collection=${foreignCollection}`)).toEqual([]);
	const shared = await listing(owner, '?scope=shared');
	expect(shared.map(({ id, favorite }) => [id, favorite])).toEqual(expect.arrayContaining([
		[sharedItem.id, true], [otherItem.id, false]
	]));
	expect(shared.map(({ id }) => id)).not.toContain(privateItem.id);
	expect((await listing(other, '?scope=shared')).find(({ id }) => id === sharedItem.id)?.favorite).toBe(false);
});
