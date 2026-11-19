import { json } from '@sveltejs/kit';
import { authMode, getEnv } from '$lib/server/env';
import { createItem, getItemDto, InvalidItemError, listItems, validItemId, type SourceMetadata } from '$lib/server/library';
import { getOpenverseImage } from '$lib/server/openverse';
import { requireRole, trustedOrigin } from '$lib/server/request';
import type { RequestHandler } from './$types';

const bodyLimit = 21 * 1024 * 1024 + 300 * 1024;
const privateHeaders = { 'cache-control': 'private, no-store' };

export const GET: RequestHandler = async (event) => {
	const { url, platform } = event;
	const env = getEnv(platform);
	const scope = url.searchParams.get('scope');
	const caller = requireRole(event, scope === 'shared' ? 'anon' : 'member', env);
	if (caller instanceof Response) return caller;

	const page = Number(url.searchParams.get('page') ?? 1);
	if (!Number.isInteger(page) || page < 1 || page > 10_000) {
		return json({ error: 'Invalid page' }, { status: 400 });
	}
	const collection = url.searchParams.get('collection');
	if (collection !== null && !validItemId(collection)) return json({ error: 'Invalid collection' }, { status: 400 });

	const result = await listItems(env, caller, {
		scope,
		collection: collection?.toLowerCase(),
		query: (url.searchParams.get('q') ?? '').trim().slice(0, 200),
		page
	});
	return json({ ...result, semanticAvailable: false }, { headers: privateHeaders });
};

export const POST: RequestHandler = async (event) => {
	const { request, url, platform } = event;
	const env = getEnv(platform);
	if (!trustedOrigin(request, url, env.ORIGIN)) return json({ error: 'Forbidden' }, { status: 403 });
	const caller = requireRole(event, 'member', env);
	if (caller instanceof Response) return caller;

	const length = request.headers.get('content-length');
	if (length === null) return json({ error: 'Length required' }, { status: 411 });
	if (!/^\d+$/.test(length)) return json({ error: 'Invalid upload' }, { status: 400 });
	if (Number(length) > bodyLimit) return json({ error: 'File too large' }, { status: 413 });

	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return json({ error: 'Invalid upload' }, { status: 400 });
	}

	const original = form.get('file');
	const thumbnail = form.get('thumbnail');
	const sha256 = form.get('sha256');
	if (!(original instanceof File)) return json({ error: 'File required' }, { status: 400 });
	if (!(thumbnail instanceof File)) return json({ error: 'Invalid thumbnail' }, { status: 400 });
	if (typeof sha256 !== 'string') return json({ error: 'Invalid hash' }, { status: 400 });

	const width = form.get('width');
	const height = form.get('height');
	if (typeof width !== 'string' || typeof height !== 'string') {
		return json({ error: 'Invalid dimensions' }, { status: 400 });
	}

	let source: SourceMetadata | null = null;
	const openverse = form.get('openverse');
	if (openverse !== null) {
		if (typeof openverse !== 'string' || !validItemId(openverse)) {
			return json({ error: 'Invalid image' }, { status: 400 });
		}
		try {
			const image = await getOpenverseImage(openverse.toLowerCase());
			if (!image.id || !image.imageUrl) return json({ error: 'Invalid image' }, { status: 400 });
			const { title, creator, creatorUrl, license, licenseUrl, attribution } = image;
			source = { source: image.source, title, creator, creatorUrl, license, licenseUrl, attribution };
		} catch {
			return json({ error: 'Unable to save image' }, { status: 400 });
		}
	}

	try {
		const { item, duplicate } = await createItem(env, caller!.id, {
			original, thumbnail, sha256, width: Number(width), height: Number(height), source,
			shared: authMode(env) === 'public'
		});
		const dto = await getItemDto(env, caller!.id, item.id);
		if (!dto) return new Response(null, { status: 404 });
		return json({ item: dto, duplicate }, {
			status: duplicate ? 200 : 201, headers: privateHeaders
		});
	} catch (error) {
		if (error instanceof InvalidItemError) return json({ error: error.message }, { status: 400 });
		throw error;
	}
};
