import { getEnv } from '$lib/server/env';
import { getVisibleItem, libraryOwner, validItemId } from '$lib/server/library';
import { mediaUrl } from '$lib/server/media-url';
import { requireRole } from '$lib/server/request';
import type { RequestHandler } from './$types';

const extensions: Record<string, string> = {
	'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp'
};

export const GET: RequestHandler = async (event) => {
	const { params, url, platform } = event;
	const env = getEnv(platform);
	const caller = requireRole(event, 'anon', env);
	if (caller instanceof Response) return caller;
	if (!validItemId(params.id)) return new Response(null, { status: 404 });
	const item = await getVisibleItem(env.DB, caller ? libraryOwner(env, caller) : undefined, params.id.toLowerCase());
	if (!item) return new Response(null, { status: 404 });

	const thumbnail = url.searchParams.get('size') === 'thumbnail' && item.thumbnailKey !== null;
	const key = thumbnail ? item.thumbnailKey! : item.storageKey;
	// Downloads are always of the original, whose type is stored on the row.
	const filename = url.searchParams.get('download') === '1'
		? `lmacaw-${item.id.slice(0, 8)}.${extensions[item.contentType] ?? 'bin'}`
		: undefined;

	// R2 serves the content type stored with the object, so a thumbnail needs no override.
	const signed = await mediaUrl(env, key, thumbnail ? undefined : item.contentType, filename);
	if (signed) {
		// The signature lasts 10 minutes; let the browser reuse this redirect for 5 of them.
		return new Response(null, { status: 302, headers: { location: signed, 'cache-control': 'private, max-age=300' } });
	}

	const object = await env.MEDIA.get(key);
	if (!object) return new Response(null, { status: 404 });
	const headers = new Headers({
		'content-type': object.httpMetadata?.contentType ?? item.contentType,
		'cache-control': 'private, max-age=300',
		'x-content-type-options': 'nosniff'
	});
	if (filename) headers.set('content-disposition', `attachment; filename="${filename}"`);
	return new Response(object.body as unknown as BodyInit, { headers });
};
