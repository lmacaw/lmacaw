import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { trustedOrigin } from '../../../../../../lib/server/request';
import { db } from '../../../../../../lib/server/db';
import { saveSharedCopy } from '../../../../../../lib/server/library';
import { storageFromEnv } from '../../../../../../lib/server/storage';

export const POST: RequestHandler = async ({ locals, request, url, params }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!trustedOrigin(request, url)) return json({ error: 'Forbidden' }, { status: 403 });
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.id)) return new Response(null, { status: 404 });
	try {
		const result = await saveSharedCopy(db(), storageFromEnv(), locals.user.id, params.id);
		const { storageKey: _storageKey, thumbnailKey: _thumbnailKey, ...item } = result.item;
		return json({ item, duplicate: result.duplicate }, { status: result.duplicate ? 200 : 201 });
	} catch (error) {
		if (error instanceof Error && error.message === 'Item not found') return new Response(null, { status: 404 });
		throw error;
	}
};
