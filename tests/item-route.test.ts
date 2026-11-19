import { env } from 'cloudflare:test';
import { expect, test } from 'vitest';
import type { User } from '$lib/server/auth';
import { DELETE, PATCH } from '../src/routes/api/v1/items/[id]/+server';
import { createTestItem, eventFor, user } from './fixtures';

const itemRoute = '/api/v1/items/[id]';
function patchEvent(actor: User | null, id: string, body: unknown) {
	return eventFor(itemRoute, `/api/v1/items/${id}`, actor, {
		method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
	}, id);
}

test.each([
	null, [], 1, { unknown: true }, { shared: 1 }, { favorite: 'true' },
	{ description: 4 }, { description: 'd'.repeat(2001) },
	{ extractedText: null }, { extractedText: 'x'.repeat(4001) },
	{ tags: null }, { tags: 'cat' }, { tags: [1] }, { tags: ['  '] },
	{ tags: ['x'.repeat(61)] }, { tags: Array(31).fill('tag') }
].map((body) => [body]))('rejects invalid PATCH data %j', async (body) => {
	const response = await PATCH(patchEvent(await user(), crypto.randomUUID(), body));
	expect(response.status).toBe(400);
	expect(await response.json()).toEqual({ error: 'Invalid request' });
});

test('checks PATCH ownership and batches text, revision and document jobs', async () => {
	const owner = await user();
	const other = await user();
	const { item } = await createTestItem(owner);
	const changes = { shared: true, favorite: true, description: 'A meme', tags: ['cat'], extractedText: 'corrected text' };
	expect((await PATCH(patchEvent(other, item.id, changes))).status).toBe(404);
	expect((await PATCH(patchEvent(owner, item.id, { shared: true, favorite: true }))).status).toBe(204);
	expect((await PATCH(patchEvent(other, item.id, changes))).status).toBe(404);
	expect(await env.DB.prepare('SELECT revision FROM items WHERE id = ?').bind(item.id).first('revision')).toBe(0);

	await env.DB.batch(['pending', 'failed', 'leased'].map((state) =>
		env.DB.prepare(`INSERT INTO ai_jobs (id, kind, item_id, owner_id, state, created_at)
			VALUES (?, 'document', ?, ?, ?, ?)`).bind(crypto.randomUUID(), item.id, owner.id, state, Date.now())));
	expect((await PATCH(patchEvent(owner, item.id, changes))).status).toBe(204);
	expect(await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(item.id).first()).toMatchObject({
		shared: 1, favorite: 1, description: 'A meme', tags: '["cat"]', ocr_override: 'corrected text', revision: 1
	});
	expect(await env.DB.prepare('SELECT state FROM ai_jobs WHERE item_id = ? AND kind = ? ORDER BY state')
		.bind(item.id, 'document').all()).toMatchObject({ results: [{ state: 'leased' }, { state: 'pending' }] });
});

test('accepts maximum-length multibyte text and all 30 tags within field limits', async () => {
	const owner = await user();
	const { item } = await createTestItem(owner);
	const body = { description: 'ế'.repeat(2000), extractedText: 'ế'.repeat(4000), tags: Array(30).fill('ế'.repeat(60)) };
	expect((await PATCH(patchEvent(owner, item.id, body))).status).toBe(204);
});

test('allows only the owner to delete an item through the route', async () => {
	const owner = await user();
	const other = await user();
	const { item } = await createTestItem(owner);
	const invoke = (actor: User) => DELETE(eventFor(itemRoute, `/api/v1/items/${item.id}`, actor, { method: 'DELETE' }, item.id));
	expect((await invoke(other)).status).toBe(404);
	expect((await invoke(owner)).status).toBe(204);
	expect((await invoke(owner)).status).toBe(404);
});
