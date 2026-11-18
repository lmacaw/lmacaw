import { json } from '@sveltejs/kit';
import { one } from '$lib/server/db';
import { getEnv } from '$lib/server/env';
import { health } from '$lib/server/health';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform }) => {
	const result = await health(async () => {
		const env = getEnv(platform);
		return one(env.DB, 'SELECT 1 AS ok').then(Boolean);
	});
	return json(result, { status: result.ok ? 200 : 503 });
};
