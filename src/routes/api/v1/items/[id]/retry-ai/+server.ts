import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '../../../../../../lib/server/db';
import { retryItemAnalysis } from '../../../../../../lib/server/ai';

export const POST: RequestHandler = async ({ locals, request, url, params }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const origin = request.headers.get('origin');
	if (origin && origin !== url.origin) return json({ error: 'Forbidden' }, { status: 403 });
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.id)) return new Response(null, { status: 404 });
	try { await retryItemAnalysis(db(), locals.user.id, params.id); return new Response(null, { status: 204 }); }
	catch (error) { if (error instanceof Error && error.message === 'Failed job not found') return new Response(null, { status: 404 }); throw error; }
};
