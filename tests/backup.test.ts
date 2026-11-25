import { env } from 'cloudflare:test';
import { expect, test, vi } from 'vitest';
import { drainBackupJobs } from '$lib/server/backup';
import { runScheduled } from '$lib/server/cron';
import { createItem } from '$lib/server/library';
import { imageInput, png, unsignedEnv, user } from './fixtures';

const hook = 'https://discord.test/hook';
const backupEnv = { ...unsignedEnv, DISCORD_BACKUP_WEBHOOK_URL: hook };
type Job = { id: string; state: string; attempts: number; next_at: number; lease_token: string | null; lease_until: number | null; message_id: string | null; error: string | null };

// Each test starts from an empty queue, so leftovers from other tests never get claimed.
async function seed(count = 1, overrides = {}) {
	await env.DB.prepare('DELETE FROM backup_jobs').run();
	const owner = await user();
	const ids: string[] = [];
	for (let i = 0; i < count; i++) ids.push((await createItem(backupEnv, owner.id, imageInput(overrides))).item.id);
	return { owner, ids };
}
const job = (itemId: string) => env.DB.prepare('SELECT * FROM backup_jobs WHERE item_id = ?').bind(itemId).first<Job>();
const setJob = (itemId: string, sql: string, ...params: unknown[]) =>
	env.DB.prepare(`UPDATE backup_jobs SET ${sql} WHERE item_id = ?`).bind(...params, itemId).run();
const reply = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const sent = (fetcher: ReturnType<typeof vi.fn>, call = 0) => {
	const [url, init] = fetcher.mock.calls[call] as [string, RequestInit];
	const form = init.body as FormData;
	return { url, form, payload: JSON.parse(form.get('payload_json') as string) };
};

test('posts the original with its ids and marks the job complete', async () => {
	const { owner, ids: [id] } = await seed(1, { source: { title: 'Cat', creator: 'An', license: 'CC0' } });
	const fetcher = vi.fn(async () => reply(200, { id: '123' }));
	await drainBackupJobs(backupEnv, fetcher);
	expect(fetcher).toHaveBeenCalledTimes(1);
	const { url, form, payload } = sent(fetcher);
	expect(url).toBe(`${hook}?wait=true`);
	const file = form.get('files[0]') as File;
	expect(file.name).toBe(`${id}.png`);
	expect(new Uint8Array(await file.arrayBuffer())).toEqual(png);
	expect(payload.allowed_mentions).toEqual({ parse: [] });
	const item = await env.DB.prepare('SELECT content_hash FROM items WHERE id = ?').bind(id).first<{ content_hash: string }>();
	expect(payload.content).toContain(id);
	expect(payload.content).toContain(owner.id);
	expect(payload.content).toContain(item!.content_hash);
	expect(payload.content).toContain('Cat by An (CC0)');
	expect(await job(id)).toMatchObject({ state: 'complete', message_id: '123', lease_token: null });
});

test('does nothing without a webhook', async () => {
	const { ids: [id] } = await seed();
	const fetcher = vi.fn();
	await drainBackupJobs(unsignedEnv, fetcher);
	expect(fetcher).not.toHaveBeenCalled();
	expect(await job(id)).toMatchObject({ state: 'pending' });
});

test('runScheduled drains backup jobs', async () => {
	const { ids: [id] } = await seed();
	const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply(200, { id: '9' }));
	try {
		await runScheduled(backupEnv);
	} finally {
		fetcher.mockRestore();
	}
	expect(await job(id)).toMatchObject({ state: 'complete', message_id: '9' });
});

test('skips an oversize original with a text notice', async () => {
	const { ids: [id] } = await seed();
	const fetcher = vi.fn(async () => reply(200, { id: '1' }));
	await drainBackupJobs({ ...backupEnv, DISCORD_BACKUP_MAX_BYTES: '1' }, fetcher);
	const { form, payload } = sent(fetcher);
	expect(form.get('files[0]')).toBeNull();
	expect(payload.content).toContain(id);
	expect(await job(id)).toMatchObject({ state: 'skipped', message_id: '1' });
});

test('413 posts a notice and skips; other 4xx fails at once', async () => {
	const { ids: [tooBig, broken] } = await seed(2);
	const fetcher = vi.fn()
		.mockResolvedValueOnce(reply(413))
		.mockResolvedValueOnce(reply(200, { id: '2' }))
		.mockResolvedValueOnce(reply(404, { message: 'Unknown Webhook' }));
	await drainBackupJobs(backupEnv, fetcher);
	expect(sent(fetcher, 1).form.get('files[0]')).toBeNull();
	expect(await job(tooBig)).toMatchObject({ state: 'skipped', message_id: '2' });
	const failed = await job(broken);
	expect(failed).toMatchObject({ state: 'failed', attempts: 1 });
	expect(failed!.error).toContain('404');
	expect(failed!.error).toContain('Unknown Webhook');
	expect(failed!.error).not.toContain(hook);
});

test('429 waits retry_after without spending an attempt and stops the run', async () => {
	const { ids: [first, second] } = await seed(2);
	const before = Date.now();
	const fetcher = vi.fn(async () => reply(429, { retry_after: 1.5 }));
	await drainBackupJobs(backupEnv, fetcher);
	expect(fetcher).toHaveBeenCalledTimes(1);
	const waiting = await job(first);
	expect(waiting).toMatchObject({ state: 'pending', attempts: 0, lease_token: null });
	expect(waiting!.next_at).toBeGreaterThanOrEqual(before + 1500);
	// The rest of the batch is released at once, not left leased for five minutes.
	expect(await job(second)).toMatchObject({ state: 'pending', attempts: 0, lease_token: null });
});

test('5xx backs off exponentially and fails after 8 attempts', async () => {
	const { ids: [id] } = await seed();
	const before = Date.now();
	await drainBackupJobs(backupEnv, vi.fn(async () => reply(502)));
	const retry = await job(id);
	expect(retry).toMatchObject({ state: 'pending', attempts: 1 });
	expect(retry!.next_at).toBeGreaterThanOrEqual(before + 120_000);
	expect(retry!.next_at).toBeLessThan(before + 125_000);

	await setJob(id, 'attempts = 7, next_at = 0');
	await drainBackupJobs(backupEnv, vi.fn(async () => reply(500)));
	expect(await job(id)).toMatchObject({ state: 'failed', attempts: 8 });
});

test('a network error counts as an attempt', async () => {
	const { ids: [id] } = await seed();
	await drainBackupJobs(backupEnv, vi.fn(async () => { throw new TypeError('network'); }));
	expect(await job(id)).toMatchObject({ state: 'pending', attempts: 1, error: 'network' });
});

test('reclaims an expired lease but not a live one', async () => {
	const { ids: [id] } = await seed();
	await setJob(id, "state = 'leased', lease_token = 'other', lease_until = ?", Date.now() + 60_000);
	const fetcher = vi.fn(async () => reply(200, { id: '3' }));
	await drainBackupJobs(backupEnv, fetcher);
	expect(fetcher).not.toHaveBeenCalled();
	await setJob(id, 'lease_until = ?', Date.now() - 1);
	await drainBackupJobs(backupEnv, fetcher);
	expect(await job(id)).toMatchObject({ state: 'complete', message_id: '3' });
});

test('a run whose lease was taken over cannot settle the job', async () => {
	const { ids: [id] } = await seed();
	const fetcher = vi.fn(async () => {
		await setJob(id, "lease_token = 'newer'");
		return reply(200, { id: '4' });
	});
	await drainBackupJobs(backupEnv, fetcher);
	expect(await job(id)).toMatchObject({ state: 'leased', lease_token: 'newer', message_id: null });
});

test('a missing original is skipped without posting', async () => {
	const { ids: [id] } = await seed();
	const item = await env.DB.prepare('SELECT storage_key FROM items WHERE id = ?').bind(id).first<{ storage_key: string }>();
	await env.MEDIA.delete(item!.storage_key);
	const fetcher = vi.fn();
	await drainBackupJobs(backupEnv, fetcher);
	expect(fetcher).not.toHaveBeenCalled();
	expect(await job(id)).toMatchObject({ state: 'skipped', error: 'original missing' });
});

test('a deleted item takes its job with it', async () => {
	const { ids: [id] } = await seed();
	await env.DB.prepare('DELETE FROM items WHERE id = ?').bind(id).run();
	const fetcher = vi.fn();
	await drainBackupJobs(backupEnv, fetcher);
	expect(fetcher).not.toHaveBeenCalled();
	expect(await job(id)).toBeNull();
});

test('claims at most 5 jobs per run', async () => {
	const { ids } = await seed(6);
	const fetcher = vi.fn(async () => reply(200, { id: '5' }));
	await drainBackupJobs(backupEnv, fetcher);
	expect(fetcher).toHaveBeenCalledTimes(5);
	expect(await job(ids[5])).toMatchObject({ state: 'pending' });
});
