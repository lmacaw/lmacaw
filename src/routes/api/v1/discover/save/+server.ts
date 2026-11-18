import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '../../../../../lib/server/db';
import { fetchPublicImage } from '../../../../../lib/server/import';
import { createItem } from '../../../../../lib/server/library';
import { getOpenverseImage } from '../../../../../lib/server/openverse';
import { readJson, trustedOrigin } from '../../../../../lib/server/request';
import { storageFromEnv } from '../../../../../lib/server/storage';

export const POST: RequestHandler = async ({ request, url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!trustedOrigin(request, url)) return json({ error: 'Forbidden' }, { status: 403 });
	let body: unknown;
	try { body = await readJson(request); } catch { return json({ error: 'Invalid request' }, { status: 400 }); }
	if (!body || typeof body !== 'object' || !('id' in body) || typeof body.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id)) return json({ error: 'Invalid image' }, { status: 400 });
	let source;
	let bytes;
	try { source = await getOpenverseImage(body.id); bytes = await fetchPublicImage(source.imageUrl); }
	catch { return json({ error: 'Unable to save image' }, { status: 502 }); }
	try {
		const result = await createItem(db(), storageFromEnv(), locals.user.id, bytes, { source: source.source, creator: source.creator, creatorUrl: source.creatorUrl, license: source.license, licenseUrl: source.licenseUrl, attribution: source.attribution });
		const { storageKey: _storageKey, thumbnailKey: _thumbnailKey, ...item } = result.item;
		return json({ item, duplicate: result.duplicate }, { status: result.duplicate ? 200 : 201 });
	} catch (error) {
		if (error instanceof Error && /image|format|size limit/i.test(error.message)) return json({ error: 'Invalid image' }, { status: 400 });
		throw error;
	}
};
