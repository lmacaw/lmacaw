import { env } from 'cloudflare:test';
import type { RequestEvent } from '@sveltejs/kit';
import { expect, test } from 'vitest';
import type { User } from '$lib/server/auth';
import { createCollection } from '$lib/server/collections';
import * as collections from '../src/routes/api/v1/collections/+server';
import * as collection from '../src/routes/api/v1/collections/[id]/+server';
import * as items from '../src/routes/api/v1/collections/[id]/items/+server';

const api = 'https://app.example/api/v1/collections';
const configuredOrigin = 'https://configured.example';

function eventFor<T extends RequestEvent>(method: string, options: {
	user?: User;
	id?: string;
	query?: string;
	items?: boolean;
	origin?: string;
	body?: unknown;
} = {}): T {
	const { user, id, query = '', origin = configuredOrigin, body } = options;
	const path = id ? `/${id}${options.items ? '/items' : ''}` : '';
	const url = new URL(api + path + query);
	const request = new Request(url, {
		method,
		headers: { origin, 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	return {
		request, url, params: { id }, locals: { user: user ?? null },
		platform: { env: { ...env, ORIGIN: configuredOrigin } }
	} as unknown as T;
}

async function createUser(): Promise<User> {
	const id = crypto.randomUUID();
	const email = `${id}@example.com`;
	await env.DB.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, 0)').bind(id, email).run();
	return { id, email, isAdmin: false };
}

test.each([
	['POST collections', (origin?: string) => collections.POST(eventFor('POST', { origin }))],
	['PATCH collection', (origin?: string) => collection.PATCH(eventFor('PATCH', { id: 'invalid', origin }))],
	['DELETE collection', (origin?: string) => collection.DELETE(eventFor('DELETE', { id: 'invalid', origin }))],
	['POST collection items', (origin?: string) => items.POST(eventFor('POST', { id: 'invalid', items: true, origin }))],
	['DELETE collection items', (origin?: string) => items.DELETE(eventFor('DELETE', { id: 'invalid', items: true, origin }))]
] as const)('%s checks origin before authentication and input', async (_path, handle) => {
	const forbidden = await handle('https://evil.example');
	expect(forbidden.status).toBe(403);
	expect(await forbidden.json()).toEqual({ error: 'Forbidden' });
	const unauthorized = await handle();
	expect(unauthorized.status).toBe(401);
	expect(await unauthorized.json()).toEqual({ error: 'Unauthorized' });
});

test('lists only the signed-in user’s collections and validates the item filter', async () => {
	expect((await collections.GET(eventFor('GET'))).status).toBe(401);
	const user = await createUser();
	const other = await createUser();
	await createCollection(env.DB, other.id, 'Private');
	const created = await collections.POST(eventFor('POST', { user, body: { name: ' Cats ' } }));
	expect(created.status).toBe(201);
	const { collection: cats } = await created.json() as { collection: { id: string; name: string } };
	expect(cats).toEqual({ id: expect.any(String), name: 'Cats' });
	const result = await collections.GET(eventFor('GET', { user }));
	expect(result.status).toBe(200);
	expect(result.headers.get('cache-control')).toBe('private, no-store');
	expect(await result.json()).toEqual({ collections: [cats] });
	const invalid = await collections.GET(eventFor('GET', { user, query: '?item=invalid' }));
	expect(invalid.status).toBe(400);
	expect(await invalid.json()).toEqual({ error: 'Invalid item' });
});

test('returns 409 on duplicate creation or renaming', async () => {
	const user = await createUser();
	await createCollection(env.DB, user.id, 'Cats');
	const dogs = await createCollection(env.DB, user.id, 'Dogs');
	const body = { name: ' Cats ' };
	const create = await collections.POST(eventFor('POST', { user, body }));
	const rename = await collection.PATCH(eventFor('PATCH', { user, id: dogs.id, body }));
	for (const response of [create, rename]) {
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({ error: 'Name already used' });
	}
	expect((await collection.PATCH(eventFor('PATCH', {
		user, id: dogs.id.toUpperCase(), body: { name: 'Good dogs' }
	}))).status).toBe(204);
	expect((await collection.DELETE(eventFor('DELETE', { user, id: dogs.id }))).status).toBe(204);
});

test('returns 400 for invalid names and identifiers', async () => {
	const user = await createUser();
	const id = crypto.randomUUID();
	const itemId = crypto.randomUUID();
	const body = { name: '   ' };
	for (const response of [
		await collections.POST(eventFor('POST', { user, body })),
		await collection.PATCH(eventFor('PATCH', { user, id, body }))
	]) {
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'Invalid name' });
	}

	for (const response of [
		await collection.PATCH(eventFor('PATCH', { user, id: 'invalid', body: { name: 'Cats' } })),
		await collection.DELETE(eventFor('DELETE', { user, id: 'invalid' })),
		await items.POST(eventFor('POST', { user, id: 'invalid', items: true, body: { itemId } })),
		await items.DELETE(eventFor('DELETE', { user, id: 'invalid', items: true, query: `?itemId=${itemId}` })),
		await items.POST(eventFor('POST', { user, id, items: true, body: { itemId: 'invalid' } })),
		await items.DELETE(eventFor('DELETE', { user, id, items: true, query: '?itemId=invalid' }))
	]) {
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'Invalid request' });
	}
});

test('returns 404 for foreign collections, invisible items and missing membership', async () => {
	const user = await createUser();
	const other = await createUser();
	const own = await createCollection(env.DB, user.id, 'Mine');
	const foreign = await createCollection(env.DB, other.id, 'Private');
	const itemId = crypto.randomUUID();
	await env.DB.prepare(`
		INSERT INTO items (id, owner_id, content_hash, storage_key, content_type, width, height, created_at)
		VALUES (?, ?, ?, ?, 'image/png', 1, 1, 0)
	`).bind(itemId, other.id, itemId, itemId).run();
	const body = { itemId };
	const query = `?itemId=${itemId}`;
	for (const response of [
		await collection.PATCH(eventFor('PATCH', { user, id: foreign.id, body: { name: 'Stolen' } })),
		await collection.DELETE(eventFor('DELETE', { user, id: foreign.id })),
		await items.POST(eventFor('POST', { user, id: foreign.id, items: true, body })),
		await items.DELETE(eventFor('DELETE', { user, id: foreign.id, items: true, query })),
		await items.POST(eventFor('POST', { user, id: own.id, items: true, body })),
		await items.DELETE(eventFor('DELETE', { user, id: own.id, items: true, query }))
	]) {
		expect(response.status).toBe(404);
		expect(await response.text()).toBe('');
	}

	await env.DB.prepare('UPDATE items SET shared = 1 WHERE id = ?').bind(itemId).run();
	// Shared items of other owners are not in the caller's library, so the collection would never list them (#31).
	expect((await items.POST(eventFor('POST', { user, id: own.id, items: true, body }))).status).toBe(404);
	const listed = await collections.GET(eventFor('GET', { user, query: `?item=${itemId}` }));
	expect(await listed.json()).toEqual({ collections: [{ ...own, hasItem: false }] });
});
