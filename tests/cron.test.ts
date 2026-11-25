import { env } from 'cloudflare:test';
import { expect, test } from 'vitest';
import { runScheduled } from '$lib/server/cron';
import { createItem } from '$lib/server/library';
import { newKey } from '$lib/server/storage';
import { createTestItem, imageInput, png, unsignedEnv, user } from './fixtures';

const queued = async (key: string) =>
	env.DB.prepare('SELECT storage_key FROM media_deletions WHERE storage_key = ?').bind(key).first();
const queue = (key: string) =>
	env.DB.prepare('INSERT INTO media_deletions (storage_key, created_at) VALUES (?, 0)').bind(key).run();

test('the scheduled handler drains queued media deletions (#30)', async () => {
	const keys = [newKey(), newKey()];
	for (const key of keys) {
		await env.MEDIA.put(key, png);
		await queue(key);
	}
	await runScheduled(unsignedEnv);
	for (const key of keys) {
		expect(await env.MEDIA.head(key)).toBeNull();
		expect(await queued(key)).toBeNull();
	}
});

test('the scheduled handler never deletes media an item still references', async () => {
	const { item } = await createTestItem(await user());
	await queue(item.storageKey);
	await runScheduled(unsignedEnv);
	expect(await env.MEDIA.head(item.storageKey)).not.toBeNull();
});

test('a failed upload queues its media when the cleanup delete also fails, and cron removes it (#30)', async () => {
	const written: string[] = [];
	let puts = 0;
	const media = {
		put: async (...args: Parameters<typeof env.MEDIA.put>) => {
			if (++puts === 2) throw new Error('R2 put failed');
			written.push(args[0]);
			return env.MEDIA.put(...args);
		},
		delete: async () => { throw new Error('R2 delete failed'); }
	} as unknown as typeof env.MEDIA;

	await expect(createItem({ ...unsignedEnv, MEDIA: media }, (await user()).id, imageInput()))
		.rejects.toThrow('R2 put failed');
	expect(written).toHaveLength(1);
	expect(await env.MEDIA.head(written[0])).not.toBeNull();
	expect(await queued(written[0])).not.toBeNull();

	await runScheduled(unsignedEnv);
	expect(await env.MEDIA.head(written[0])).toBeNull();
	expect(await queued(written[0])).toBeNull();
});
