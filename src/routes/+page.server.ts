import { one } from '$lib/server/db';
import { authMode, getEnv, mailConfigured } from '$lib/server/env';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform }) => {
	const env = getEnv(platform);
	const mode = authMode(env);
	const user = locals.user;
	return {
		user,
		mode,
		isAdmin: user?.isAdmin ?? false,
		needsSetup: mode === 'password' && !(await one(env.DB, 'SELECT 1 AS x FROM users LIMIT 1')),
		mailEnabled: mailConfigured(env),
		aiEnabled: true as const
	};
};
