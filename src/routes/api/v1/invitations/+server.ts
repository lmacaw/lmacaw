import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { trustedOrigin } from '../../../../lib/server/request';
import { createInvitation } from '../../../../lib/server/auth';
import { db } from '../../../../lib/server/db';

export const POST: RequestHandler = async ({ locals, request, url }) => {
	if (!trustedOrigin(request, url)) return json({ error: 'Forbidden' }, { status: 403 });
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!locals.user.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });
	const token = await createInvitation(db(), locals.user.id);
	return json({ token }, { status: 201, headers: { 'cache-control': 'no-store' } });
};
