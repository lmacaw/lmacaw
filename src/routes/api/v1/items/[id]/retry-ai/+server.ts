import { json } from '@sveltejs/kit';
import { getEnv } from '$lib/server/env';
import { libraryOwner, retryImageAnalysis, validItemId } from '$lib/server/library';
import { requireRole, trustedOrigin } from '$lib/server/request';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const { request, url, params, platform } = event;
	const env = getEnv(platform);
	if (!trustedOrigin(request, url, env.ORIGIN)) return json({ error: 'Forbidden' }, { status: 403 });
	const caller = requireRole(event, 'member', env);
	if (caller instanceof Response) return caller;
	if (!validItemId(params.id)) return new Response(null, { status: 404 });
	// ponytail: 404 also covers "latest job is not failed"; the dialog only offers retry on failed jobs.
	const retried = await retryImageAnalysis(env.DB, libraryOwner(env, caller!), params.id.toLowerCase());
	return new Response(null, { status: retried ? 204 : 404 });
};
