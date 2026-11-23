import { env } from 'cloudflare:test';
import { expect, test } from 'vitest';
import type { User } from '$lib/server/auth';
import { getItemDto } from '$lib/server/library';
import { POST } from '../src/routes/api/v1/items/[id]/retry-ai/+server';
import { createTestItem, eventFor, unsignedEnv, user } from './fixtures';

function retry(actor: User, id: string) {
	return POST(eventFor('/api/v1/items/[id]/retry-ai', `/api/v1/items/${id}/retry-ai`, actor, { method: 'POST' }, id));
}

test('requeues a failed image analysis', async () => {
	const owner = await user();
	const { item } = await createTestItem(owner);
	await env.DB.prepare("UPDATE ai_jobs SET state = 'failed', attempts = 3 WHERE item_id = ? AND kind = 'image'").bind(item.id).run();
	expect((await getItemDto(unsignedEnv, owner.id, item.id))?.ai_state).toBe('failed');
	expect((await retry(owner, item.id)).status).toBe(204);
	expect((await getItemDto(unsignedEnv, owner.id, item.id))?.ai_state).toBe('pending');
	expect((await retry(owner, item.id)).status).toBe(404);
});

test('returns 404 for someone else’s failed analysis', async () => {
	const owner = await user();
	const { item } = await createTestItem(owner);
	await env.DB.prepare("UPDATE ai_jobs SET state = 'failed' WHERE item_id = ? AND kind = 'image'").bind(item.id).run();
	expect((await retry(await user(), item.id)).status).toBe(404);
	expect((await getItemDto(unsignedEnv, owner.id, item.id))?.ai_state).toBe('failed');
});
