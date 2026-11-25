import type { Env } from './env';
import { cleanupDeletedMedia } from './library';

export async function runScheduled(env: Env): Promise<void> {
	// ponytail: one batch of 50 per minute; loop batches if the queue ever outgrows that.
	await cleanupDeletedMedia(env);
}
