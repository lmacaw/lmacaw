import { env } from 'cloudflare:test';
import { expect, test } from 'vitest';
import type { User } from '$lib/server/auth';
import { updateItem } from '$lib/server/library';
import { foldText, ftsQuery, indexItem } from '$lib/server/search';
import { GET } from '../src/routes/api/v1/items/+server';
import { createTestItem, listEvent, unsignedEnv, user } from './fixtures';

async function find(actor: User, query: string, scope = 'library') {
	const params = new URLSearchParams({ q: query, scope });
	const response = await GET(listEvent(actor, `?${params}`));
	expect(response.status).toBe(200);
	const body = await response.json() as { items: { id: string }[] };
	return body.items.map(({ id }) => id);
}

test('normalizes case and đ, treats punctuation as separators, and caps prefix terms', () => {
	expect(foldText('ĐỒ ĂN')).toBe('dồ ăn');
	expect(ftsQuery('Đồ ăn')).toBe('"do"* "an"*');
	expect(ftsQuery('"*-')).toBeNull();
	expect(ftsQuery('a b c d e f g h i j')).toBe('"a"* "b"* "c"* "d"* "e"* "f"* "g"* "h"*');
});

test('matches unaccented Vietnamese tags and uppercase query text', async () => {
	const owner = await user();
	const { item } = await createTestItem(owner, { initial: { description: 'con mèo', tags: ['đồ ăn'], extractedText: null } });
	expect(await find(owner, 'do an')).toEqual([item.id]);
	expect(await find(owner, 'MÈO')).toEqual([item.id]);
	expect(await find(owner, '"do"* -an')).toEqual([item.id]);
	expect(await find(owner, 'banana')).toEqual([]);
});

test.each(['"', '*', '-'])('lists normally for a punctuation-only query %s', async (query) => {
	const owner = await user();
	const { item } = await createTestItem(owner);
	expect(await find(owner, query)).toEqual([item.id]);
});

test('replaces indexed tags after an owner edit', async () => {
	const owner = await user();
	const { item } = await createTestItem(owner, { initial: { description: '', tags: ['oldtag'], extractedText: null } });
	expect(await find(owner, 'oldtag')).toEqual([item.id]);
	await updateItem(unsignedEnv, owner.id, item.id, { tags: ['newtag'] });
	expect(await find(owner, 'oldtag')).toEqual([]);
	expect(await find(owner, 'newtag')).toEqual([item.id]);
});

test('indexes analysis fallback text and replaces it with owner fields when edited', async () => {
	const owner = await user();
	const { item } = await createTestItem(owner);
	await env.DB.batch([
		env.DB.prepare(`INSERT INTO item_analysis (item_id, description, extracted_text, suggested_tags, updated_at)
			VALUES (?, ?, ?, ?, ?)`).bind(item.id, 'blue cat', 'late meeting', '["tired"]', Date.now()),
		...indexItem(env.DB, item.id)
	]);
	expect(await find(owner, 'blue meeting tired')).toEqual([item.id]);
	await updateItem(unsignedEnv, owner.id, item.id, { description: 'orange cat', extractedText: '', tags: ['rested'] });
	expect(await find(owner, 'orange rested')).toEqual([item.id]);
	for (const word of ['blue', 'meeting', 'tired']) expect(await find(owner, word)).toEqual([]);
});

test('shared search filters private items even if an FTS row is stale', async () => {
	const owner = await user();
	const viewer = await user();
	const initial = { description: 'privacytoken', tags: [], extractedText: null };
	const { item: privateItem } = await createTestItem(owner, { initial });
	const { item: sharedItem } = await createTestItem(owner, { initial });
	await updateItem(unsignedEnv, owner.id, sharedItem.id, { shared: true });
	await env.DB.prepare('UPDATE item_search SET shared = 1 WHERE item_id = ?').bind(privateItem.id).run();
	expect(await find(viewer, 'privacytoken', 'shared')).toEqual([sharedItem.id]);
});
