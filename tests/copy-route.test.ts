import { env } from 'cloudflare:test';
import { expect, test } from 'vitest';
import type { User } from '$lib/server/auth';
import { deleteItem, getVisibleItem, updateItem } from '$lib/server/library';
import { POST } from '../src/routes/api/v1/items/[id]/copy/+server';
import { createTestItem, eventFor, png, unsignedEnv, user, webp } from './fixtures';

function copy(actor: User, id: string) {
	return POST(eventFor('/api/v1/items/[id]/copy', `/api/v1/items/${id}/copy`, actor, { method: 'POST' }, id));
}

test('copies a shared item, merged text and both R2 objects into the recipient’s private library', async () => {
	const owner = await user();
	const recipient = await user();
	const source = { source: 'https://example.com/image', creator: 'An' };
	const { item } = await createTestItem(owner, { source, initial: { description: 'Owner text', tags: [], extractedText: null } });
	await env.DB.prepare(`INSERT INTO item_analysis (item_id, description, suggested_tags, extracted_text, updated_at)
		VALUES (?, ?, ?, ?, ?)`).bind(item.id, 'AI description', '["suggested"]', 'AI OCR', Date.now()).run();
	await updateItem(unsignedEnv, owner.id, item.id, { shared: true, favorite: true });
	const response = await copy(recipient, item.id);
	expect(response.status).toBe(201);
	const data = await response.json();
	expect(data).toMatchObject({ duplicate: false, item: {
		description: 'Owner text', tags: ['suggested'], extracted_text: 'AI OCR', source_metadata: source,
		shared: false, favorite: false
	} });
	expect(data.item.id).not.toBe(item.id);
	const saved = await getVisibleItem(env.DB, recipient.id, data.item.id);
	expect(saved).toMatchObject({ ownerId: recipient.id });
	expect(saved?.storageKey).not.toBe(item.storageKey);
	expect(saved?.thumbnailKey).not.toBe(item.thumbnailKey);
	expect(await getVisibleItem(env.DB, owner.id, data.item.id)).toBeNull();
	expect(await getVisibleItem(env.DB, owner.id, item.id)).toEqual({ ...item, shared: true });
	expect(await env.DB.prepare('SELECT content_hash FROM items WHERE id = ?').bind(data.item.id).first())
		.toEqual(await env.DB.prepare('SELECT content_hash FROM items WHERE id = ?').bind(item.id).first());
	const duplicate = await copy(recipient, item.id);
	expect(duplicate.status).toBe(200);
	expect(await duplicate.json()).toEqual({ ...data, duplicate: true });

	await deleteItem(unsignedEnv, owner.id, item.id);
	expect(await (await env.MEDIA.get(saved!.storageKey))?.bytes()).toEqual(png);
	expect(await (await env.MEDIA.get(saved!.thumbnailKey!))?.bytes()).toEqual(webp);
});

test('returns 404 when copying someone else’s private item', async () => {
	const owner = await user();
	const other = await user();
	const { item } = await createTestItem(owner);
	expect((await copy(other, item.id)).status).toBe(404);
	expect(await env.DB.prepare('SELECT id FROM items WHERE owner_id = ?').bind(other.id).first()).toBeNull();
});
