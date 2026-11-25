import { env } from 'cloudflare:test';
import { expect, test } from 'vitest';
import type { User } from '$lib/server/auth';
import { createCollection } from '$lib/server/collections';
import { getItemDto, listItems, updateItem } from '$lib/server/library';
import type { Item } from '$lib/types';
import { POST as collect } from '../src/routes/api/v1/collections/[id]/items/+server';
import { GET as list, POST as upload } from '../src/routes/api/v1/items/+server';
import { DELETE as remove, PATCH as patch } from '../src/routes/api/v1/items/[id]/+server';
import { GET as media } from '../src/routes/api/v1/items/[id]/media/+server';
import {
	createTestItem, itemsRoute, listEvent, memberRouteCases, png, publicBindings, publicEventFor, unsignedEnv,
	uploadEvent, uploadForm, user
} from './fixtures';

test.each(memberRouteCases(publicBindings))('returns 403 to an anonymous caller of %s', async (_route, invoke) => {
	const response = await invoke();
	expect(response.status).toBe(403);
	expect(await response.json()).toEqual({ error: 'Forbidden' });
});

test('lists and searches only shared items and hides favorites from anonymous callers', async () => {
	const owner = await user(true);
	const initial = { description: 'Capybara meme', tags: [], extractedText: null };
	const { item: shared } = await createTestItem(owner, { shared: true, initial });
	await createTestItem(owner, { initial });
	const { item: other } = await createTestItem(owner, { shared: true, initial: { ...initial, description: 'Otter meme' } });
	await updateItem(unsignedEnv, owner.id, shared.id, { favorite: true });

	const listing = await list(listEvent(null, '?scope=shared', publicBindings));
	expect(listing.status).toBe(200);
	const { items } = await listing.json() as { items: Item[] };
	expect(items.map(({ id }) => id).sort()).toEqual([shared.id, other.id].sort());
	expect(items.every(({ shared, favorite }) => shared && favorite === false)).toBe(true);

	const search = await list(listEvent(null, '?scope=shared&q=capybara', publicBindings));
	expect(search.status).toBe(200);
	expect((await search.json()).items).toEqual([
		expect.objectContaining({ id: shared.id, shared: true, favorite: false })
	]);
	expect((await listItems(unsignedEnv, null, { scope: 'library' })).items).toEqual(items);
});

test('serves shared media anonymously and returns the same 404 for unshared and missing media', async () => {
	const owner = await user(true);
	const { item: shared } = await createTestItem(owner, { shared: true });
	const { item: unshared } = await createTestItem(owner);
	const getMedia = (id: string, actor: User | null = null) =>
		media(publicEventFor('/api/v1/items/[id]/media', `/api/v1/items/${id}/media`, actor, undefined, id));

	const visible = await getMedia(shared.id);
	expect(visible.status).toBe(200);
	expect(await visible.bytes()).toEqual(png);

	for (const id of [unshared.id, crypto.randomUUID()]) {
		const hidden = await getMedia(id);
		expect(hidden.status).toBe(404);
		expect(hidden.headers.get('location')).toBeNull();
		expect(await hidden.text()).toBe('');
	}
	const privateMedia = await getMedia(unshared.id, owner);
	expect(privateMedia.status).toBe(200);
	expect(await privateMedia.bytes()).toEqual(png);
});

test('requires an admin to upload, shares new uploads, and preserves visibility on duplicate uploads', async () => {
	const form = uploadForm();
	const member = await user();
	expect((await upload(await uploadEvent(member, form, publicBindings))).status).toBe(403);

	const admin = await user(true);
	const created = await upload(await uploadEvent(admin, form, publicBindings));
	expect(created.status).toBe(201);
	const { item } = await created.json();
	expect(item.shared).toBe(true);

	const unshare = publicEventFor('/api/v1/items/[id]', `/api/v1/items/${item.id}`, admin, {
		method: 'PATCH', body: JSON.stringify({ shared: false })
	}, item.id);
	expect((await patch(unshare)).status).toBe(204);

	const duplicate = await upload(await uploadEvent(admin, form, publicBindings));
	expect(duplicate.status).toBe(200);
	expect(await duplicate.json()).toMatchObject({ duplicate: true, item: { id: item.id, shared: false } });
});

test('lets every admin see and manage items another admin uploaded (#29)', async () => {
	const first = await user(true);
	const second = await user(true);
	const { item } = await createTestItem(first, { initial: { description: 'Takedown me', tags: [], extractedText: null } });
	const itemEvent = (init?: RequestInit) =>
		publicEventFor('/api/v1/items/[id]', `/api/v1/items/${item.id}`, second, init, item.id);

	const library = await list(publicEventFor(itemsRoute, `${itemsRoute}?scope=library`, second));
	expect((await library.json()).items.map(({ id }: Item) => id)).toContain(item.id);

	const viewed = await media(publicEventFor('/api/v1/items/[id]/media', `/api/v1/items/${item.id}/media`, second, undefined, item.id));
	expect(viewed.status).toBe(200);

	expect((await patch(itemEvent({ method: 'PATCH', body: JSON.stringify({ shared: true }) }))).status).toBe(204);
	expect((await remove(itemEvent({ method: 'DELETE' }))).status).toBe(204);
	expect(await getItemDto(unsignedEnv, first.id, item.id)).toBeNull();
});

test('lets an admin collect and list an item another admin uploaded (#29, #31)', async () => {
	const first = await user(true);
	const second = await user(true);
	const { item } = await createTestItem(first);
	const { id } = await createCollection(env.DB, second.id, 'Takedowns');
	const collectionItems = '/api/v1/collections/[id]/items';
	const added = await collect(publicEventFor(collectionItems, `/api/v1/collections/${id}/items`, second, {
		method: 'POST', body: JSON.stringify({ itemId: item.id })
	}, id));
	expect(added.status).toBe(204);

	const listed = await list(publicEventFor(itemsRoute, `${itemsRoute}?scope=collection&collection=${id}`, second));
	expect((await listed.json()).items.map(({ id }: Item) => id)).toEqual([item.id]);
});
