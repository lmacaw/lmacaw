import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '../../../../../../lib/server/db';
import { claimJob } from '../../../../../../lib/server/ai';
import { authorizedWorker } from '../../../../../../lib/server/worker-auth';

export const POST: RequestHandler = async ({ request }) => {
	if (!authorizedWorker(request.headers.get('authorization'), process.env.AI_WORKER_TOKEN)) return json({ error: 'Unauthorized' }, { status: 401 });
	return json({ job: await claimJob(db()) }, { headers: { 'cache-control': 'no-store' } });
};
