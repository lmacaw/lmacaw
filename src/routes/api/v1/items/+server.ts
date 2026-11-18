import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { trustedOrigin } from '../../../../lib/server/request';
import { db } from '../../../../lib/server/db';
import { createItem } from '../../../../lib/server/library';
import { storageFromEnv } from '../../../../lib/server/storage';
import { requestSemanticMatches } from '../../../../lib/server/ai';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const shared = url.searchParams.get('scope') === 'shared';
	const favoriteOnly = url.searchParams.get('scope') === 'favorites';
	const collection = url.searchParams.get('collection');
	const requestedPage = Number(url.searchParams.get('page') ?? 1);
	if (!Number.isInteger(requestedPage) || requestedPage < 1 || requestedPage > 10000) return json({ error: 'Invalid page' }, { status: 400 });
	const offset = (requestedPage - 1) * 200;
	if (collection && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(collection)) return json({ error: 'Invalid collection' }, { status: 400 });
	const query = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
	const rows = shared
		? await db()`SELECT i.id, i.content_type, i.width, i.height, i.shared, CASE WHEN i.owner_id = ${locals.user.id} THEN i.favorite ELSE false END AS favorite, i.description, i.tags, i.source_metadata, a.description AS ai_description, COALESCE(i.ocr_override, a.extracted_text) AS extracted_text, a.suggested_tags, (SELECT state FROM ai_jobs j WHERE j.item_id = i.id AND j.kind = 'image' ORDER BY j.created_at DESC LIMIT 1) AS ai_state FROM items i LEFT JOIN item_analysis a ON a.item_id = i.id WHERE i.shared = true AND strpos(lower(concat_ws(' ', COALESCE(NULLIF(i.description, ''), a.description), array_to_string(i.tags, ' '), COALESCE(i.ocr_override, a.extracted_text), array_to_string(a.suggested_tags, ' '))), lower(${query})) > 0 ORDER BY i.created_at DESC, i.id DESC LIMIT 201 OFFSET ${offset}`
		: await db()`SELECT i.id, i.content_type, i.width, i.height, i.shared, i.favorite, i.description, i.tags, i.source_metadata, a.description AS ai_description, COALESCE(i.ocr_override, a.extracted_text) AS extracted_text, a.suggested_tags, (SELECT state FROM ai_jobs j WHERE j.item_id = i.id AND j.kind = 'image' ORDER BY j.created_at DESC LIMIT 1) AS ai_state FROM items i LEFT JOIN item_analysis a ON a.item_id = i.id WHERE i.owner_id = ${locals.user.id} AND (NOT ${favoriteOnly}::boolean OR i.favorite = true) AND (${collection}::text IS NULL OR EXISTS (SELECT 1 FROM collection_items ci JOIN collections c ON c.id = ci.collection_id WHERE ci.item_id = i.id AND c.id::text = ${collection}::text AND c.owner_id = ${locals.user.id})) AND strpos(lower(concat_ws(' ', COALESCE(NULLIF(i.description, ''), a.description), array_to_string(i.tags, ' '), COALESCE(i.ocr_override, a.extracted_text), array_to_string(a.suggested_tags, ' '))), lower(${query})) > 0 ORDER BY i.created_at DESC, i.id DESC LIMIT 201 OFFSET ${offset}`;
	let semanticAvailable = false;
	const hasMore = rows.length > 200;
	if (hasMore) rows.pop();
	if (query && process.env.AI_WORKER_TOKEN && requestedPage === 1) {
		const matches = await requestSemanticMatches(db(), locals.user.id, shared, query, 4000, favoriteOnly, collection);
		semanticAvailable = matches !== null;
		if (matches?.length) {
			const ids = JSON.stringify(matches.map((item) => item.id));
			const semanticRows = shared
				? await db()`SELECT i.id, i.content_type, i.width, i.height, i.shared, CASE WHEN i.owner_id = ${locals.user.id} THEN i.favorite ELSE false END AS favorite, i.description, i.tags, i.source_metadata, a.description AS ai_description, COALESCE(i.ocr_override, a.extracted_text) AS extracted_text, a.suggested_tags, (SELECT state FROM ai_jobs j WHERE j.item_id = i.id AND j.kind = 'image' ORDER BY j.created_at DESC LIMIT 1) AS ai_state FROM items i LEFT JOIN item_analysis a ON a.item_id = i.id WHERE i.shared = true AND i.id::text IN (SELECT jsonb_array_elements_text(${ids}::text::jsonb))`
				: await db()`SELECT i.id, i.content_type, i.width, i.height, i.shared, i.favorite, i.description, i.tags, i.source_metadata, a.description AS ai_description, COALESCE(i.ocr_override, a.extracted_text) AS extracted_text, a.suggested_tags, (SELECT state FROM ai_jobs j WHERE j.item_id = i.id AND j.kind = 'image' ORDER BY j.created_at DESC LIMIT 1) AS ai_state FROM items i LEFT JOIN item_analysis a ON a.item_id = i.id WHERE i.owner_id = ${locals.user.id} AND (NOT ${favoriteOnly}::boolean OR i.favorite = true) AND (${collection}::text IS NULL OR EXISTS (SELECT 1 FROM collection_items ci JOIN collections c ON c.id = ci.collection_id WHERE ci.item_id = i.id AND c.id::text = ${collection}::text AND c.owner_id = ${locals.user.id})) AND i.id::text IN (SELECT jsonb_array_elements_text(${ids}::text::jsonb))`;
			const byId = new Map(semanticRows.map((item: { id: string }) => [item.id, item]));
			const seen = new Set(rows.map((item: { id: string }) => item.id));
			for (const match of matches) if (!seen.has(match.id) && byId.has(match.id)) rows.push(byId.get(match.id));
		}
	}
	return json({ items: rows, semanticAvailable, hasMore }, { headers: { 'cache-control': 'private, no-store' } });
};

export const POST: RequestHandler = async ({ locals, request, url }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!trustedOrigin(request, url)) return json({ error: 'Forbidden' }, { status: 403 });
	const reader = request.body?.getReader();
	if (!reader) return json({ error: 'File required' }, { status: 400 });
	const parts: Uint8Array[] = [];
	let length = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		length += value.byteLength;
		if (length > 21 * 1024 * 1024) { await reader.cancel(); return json({ error: 'File too large' }, { status: 413 }); }
		parts.push(value);
	}
	let form: FormData;
	try {
		const body = new Blob(parts as BlobPart[]);
		form = await new Response(body, { headers: { 'content-type': request.headers.get('content-type') ?? '' } }).formData();
	} catch { return json({ error: 'Invalid upload' }, { status: 400 }); }
	const file = form.get('file');
	if (!(file instanceof File)) return json({ error: 'File required' }, { status: 400 });
	try {
		const result = await createItem(db(), storageFromEnv(), locals.user.id, new Uint8Array(await file.arrayBuffer()));
		const { storageKey: _storageKey, thumbnailKey: _thumbnailKey, ...item } = result.item;
		return json({ item, duplicate: result.duplicate }, { status: result.duplicate ? 200 : 201 });
	} catch (error) {
		if (error instanceof Error && /image|format|size limit/i.test(error.message)) return json({ error: 'Invalid image' }, { status: 400 });
		throw error;
	}
};
