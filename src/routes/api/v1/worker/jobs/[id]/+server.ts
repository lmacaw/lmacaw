import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '../../../../../../lib/server/db';
import { completeDocumentJob, completeImageJob, completeQueryJob, failJob, renewLease } from '../../../../../../lib/server/ai';
import type { ImageResult } from '../../../../../../lib/server/ai';
import { readJson } from '../../../../../../lib/server/request';
import { authorizedWorker } from '../../../../../../lib/server/worker-auth';

export const POST: RequestHandler = async ({ request, params }) => {
	if (!authorizedWorker(request.headers.get('authorization'), process.env.AI_WORKER_TOKEN)) return json({ error: 'Unauthorized' }, { status: 401 });
	const lease = request.headers.get('x-job-lease');
	const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	if (!lease || !uuid.test(lease) || !uuid.test(params.id)) return json({ error: 'Invalid request' }, { status: 400 });
	let body: unknown;
	try { body = await readJson(request, 65536); } catch { return json({ error: 'Invalid request' }, { status: 400 }); }
	if (!body || typeof body !== 'object' || !('action' in body)) return json({ error: 'Invalid request' }, { status: 400 });
	try {
		if (body.action === 'heartbeat') return new Response(null, { status: await renewLease(db(), params.id, lease) ? 204 : 409 });
		if (body.action === 'fail') return new Response(null, { status: await failJob(db(), params.id, lease) ? 204 : 409 });
		if (body.action === 'image' && 'result' in body && body.result && typeof body.result === 'object') await completeImageJob(db(), params.id, lease, body.result as ImageResult);
		else if (body.action === 'document' && 'embedding' in body && 'model' in body && Array.isArray(body.embedding) && typeof body.model === 'string') await completeDocumentJob(db(), params.id, lease, body.embedding, body.model);
		else if (body.action === 'query' && 'embedding' in body && 'model' in body && Array.isArray(body.embedding) && typeof body.model === 'string') await completeQueryJob(db(), params.id, lease, body.embedding, body.model);
		else return json({ error: 'Invalid request' }, { status: 400 });
		return new Response(null, { status: 204 });
	} catch { return json({ error: 'Invalid or expired job' }, { status: 409 }); }
};
