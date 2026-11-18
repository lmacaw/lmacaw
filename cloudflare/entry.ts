import type { ExecutionContext, ScheduledController } from '@cloudflare/workers-types';
import worker from '../.svelte-kit/cloudflare/_worker.js';
import { runScheduled } from '../src/lib/server/cron';
import type { Env } from '../src/lib/server/env';

export default {
	fetch: worker.fetch,
	scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
		ctx.waitUntil(runScheduled(env));
	}
};
