import { now } from './db';
import type { Env } from './env';

// Optional off-site backup (#52): every new original is posted to one Discord webhook.
// Jobs are queued in storeItem's insert batch and drained here by the per-minute cron.
const batchSize = 5;
const leaseMs = 5 * 60_000;
const maxAttempts = 8;
const defaultMaxBytes = 10 * 1024 * 1024;
const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

type Claimed = {
	id: string; item_id: string; attempts: number;
	storage_key: string; owner_id: string; content_hash: string; content_type: string; source_metadata: string | null;
};
type Outcome =
	| { state: 'complete' | 'skipped'; messageId?: string; error?: string }
	| { state: 'retry'; error: string }
	| { state: 'failed'; error: string }
	| { state: 'wait'; ms: number };

function describe(job: Claimed): string {
	const lines = [`item ${job.item_id}`, `owner ${job.owner_id}`, `sha256 ${job.content_hash}`, `type ${job.content_type}`];
	const source = job.source_metadata ? JSON.parse(job.source_metadata) as { title?: string; creator?: string; license?: string } : null;
	if (source?.title || source?.creator) {
		lines.push(`source: ${source.title ?? 'untitled'}${source.creator ? ` by ${source.creator}` : ''}${source.license ? ` (${source.license})` : ''}`);
	}
	return lines.join('\n').slice(0, 1900);
}

async function post(webhook: string, fetcher: typeof fetch, content: string, file?: File): Promise<Response> {
	const form = new FormData();
	form.set('payload_json', JSON.stringify({ content, allowed_mentions: { parse: [] } }));
	if (file) form.set('files[0]', file);
	return fetcher(`${webhook}?wait=true`, { method: 'POST', body: form });
}
const messageId = async (response: Response) => ((await response.json().catch(() => ({}))) as { id?: string }).id;
// Discord bodies never echo the webhook URL; truncate so a huge error page cannot bloat the row.
const errorOf = async (response: Response) => `${response.status} ${(await response.text().catch(() => '')).slice(0, 500)}`;

async function send(env: Env, fetcher: typeof fetch, webhook: string, job: Claimed): Promise<Outcome> {
	const maxBytes = Number(env.DISCORD_BACKUP_MAX_BYTES) || defaultMaxBytes;
	const content = describe(job);
	const notice = async (reason: string): Promise<Outcome> => {
		const response = await post(webhook, fetcher, `${content}\nnot attached: ${reason}`);
		return response.ok ? { state: 'skipped', messageId: await messageId(response), error: reason } : settle(response);
	};
	const settle = async (response: Response): Promise<Outcome> => {
		if (response.ok) return { state: 'complete', messageId: await messageId(response) };
		if (response.status === 429) {
			const { retry_after: seconds } = await response.json().catch(() => ({})) as { retry_after?: number };
			return { state: 'wait', ms: Math.ceil((Number(seconds) || 60) * 1000) };
		}
		if (response.status >= 500) return { state: 'retry', error: await errorOf(response) };
		return { state: 'failed', error: await errorOf(response) };
	};

	const object = await env.MEDIA.head(job.storage_key);
	if (!object) return { state: 'skipped', error: 'original missing' };
	if (object.size > maxBytes) return notice(`original is ${object.size} bytes, over the ${maxBytes} byte limit`);
	const original = await env.MEDIA.get(job.storage_key);
	if (!original) return { state: 'skipped', error: 'original missing' };
	const file = new File([await original.arrayBuffer()], `${job.item_id}.${extensions[job.content_type] ?? 'bin'}`, { type: job.content_type });
	const response = await post(webhook, fetcher, content, file);
	if (response.status === 413) return notice('too large for this Discord server');
	return settle(response);
}

/** Sends up to 5 due backups. Each job settles only while its lease token is still ours. */
export async function drainBackupJobs(env: Env, fetcher: typeof fetch = fetch): Promise<void> {
	const webhook = env.DISCORD_BACKUP_WEBHOOK_URL;
	if (!webhook) return;
	const db = env.DB;
	const token = crypto.randomUUID();
	const start = now();
	const { results: claimed } = await db.prepare(`
		UPDATE backup_jobs SET state = 'leased', lease_token = ?1, lease_until = ?2
		WHERE id IN (
			SELECT id FROM backup_jobs
			WHERE (state = 'pending' AND next_at <= ?3) OR (state = 'leased' AND lease_until <= ?3)
			ORDER BY created_at, id LIMIT ?4
		)
		RETURNING id
	`).bind(token, start + leaseMs, start, batchSize).all<{ id: string }>();
	if (!claimed.length) return;
	const { results: jobs } = await db.prepare(`
		SELECT b.id, b.item_id, b.attempts, i.storage_key, i.owner_id, i.content_hash, i.content_type, i.source_metadata
		FROM backup_jobs b JOIN items i ON i.id = b.item_id
		WHERE b.lease_token = ? ORDER BY b.created_at, b.id
	`).bind(token).all<Claimed>();

	const update = (job: Claimed, sql: string, ...params: unknown[]) =>
		db.prepare(`UPDATE backup_jobs SET ${sql}, lease_token = NULL, lease_until = NULL WHERE id = ? AND lease_token = ?`)
			.bind(...params, job.id, token).run();

	for (const [index, job] of jobs.entries()) {
		let outcome: Outcome;
		try {
			outcome = await send(env, fetcher, webhook, job);
		} catch (error) {
			outcome = { state: 'retry', error: (error instanceof Error ? error.message : String(error)).slice(0, 500) };
		}
		if (outcome.state === 'wait') {
			// Rate limited: this job waits Discord's retry_after, the rest of the batch goes back at once.
			await update(job, "state = 'pending', next_at = ?", now() + outcome.ms);
			for (const rest of jobs.slice(index + 1)) await update(rest, "state = 'pending'");
			return;
		}
		if (outcome.state === 'complete' || outcome.state === 'skipped') {
			await update(job, 'state = ?, message_id = ?, error = ?', outcome.state, outcome.messageId ?? null, outcome.error ?? null);
		} else {
			const attempts = job.attempts + 1;
			const give = outcome.state === 'failed' || attempts >= maxAttempts;
			const backoff = Math.min(2 ** attempts, 60) * 60_000;
			await update(job, 'state = ?, attempts = ?, next_at = ?, error = ?', give ? 'failed' : 'pending', attempts, now() + backoff, outcome.error);
		}
	}
}
