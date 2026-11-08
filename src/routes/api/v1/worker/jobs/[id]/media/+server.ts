import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '../../../../../../../lib/server/db';
import { storageFromEnv } from '../../../../../../../lib/server/storage';
import { authorizedWorker } from '../../../../../../../lib/server/worker-auth';

export const GET: RequestHandler = async ({ request, params }) => {
	if (!authorizedWorker(request.headers.get('authorization'), process.env.AI_WORKER_TOKEN)) return json({ error: 'Unauthorized' }, { status: 401 });
	const lease = request.headers.get('x-job-lease');
	const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	if (!lease || !uuid.test(lease) || !uuid.test(params.id)) return new Response(null, { status: 404 });
	const rows = await db()`SELECT i.storage_key, i.content_type FROM ai_jobs j JOIN items i ON i.id = j.item_id WHERE j.id = ${params.id} AND j.lease_token = ${lease} AND j.state = 'leased' AND j.lease_until > now()`;
	if (!rows.length) return new Response(null, { status: 404 });
	const bytes = await storageFromEnv().get(rows[0].storage_key);
	return new Response(bytes as BodyInit, { headers: { 'content-type': rows[0].content_type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
};
