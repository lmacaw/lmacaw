import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '../../../../../lib/server/db';
import { deleteItem } from '../../../../../lib/server/library';
import { enqueueDocument } from '../../../../../lib/server/ai';
import { readJson, trustedOrigin } from '../../../../../lib/server/request';
import { storageFromEnv } from '../../../../../lib/server/storage';

const validId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export const PATCH: RequestHandler = async ({ locals, request, url, params }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!trustedOrigin(request, url)) return json({ error: 'Forbidden' }, { status: 403 });
	if (!validId(params.id)) return new Response(null, { status: 404 });
	let body: unknown;
	try { body = await readJson(request); } catch { return json({ error: 'Invalid request' }, { status: 400 }); }
	if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid request' }, { status: 400 });
	const value = body as Record<string, unknown>;
	if (Object.keys(value).some((key) => !['shared', 'favorite', 'description', 'tags', 'extractedText'].includes(key)) ||
		(value.shared !== undefined && typeof value.shared !== 'boolean') ||
		(value.favorite !== undefined && typeof value.favorite !== 'boolean') ||
		(value.description !== undefined && (typeof value.description !== 'string' || value.description.length > 2000)) ||
		(value.extractedText !== undefined && (typeof value.extractedText !== 'string' || value.extractedText.length > 4000)) ||
		(value.tags !== undefined && (!Array.isArray(value.tags) || value.tags.length > 30 || value.tags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.length > 60)))) {
		return json({ error: 'Invalid request' }, { status: 400 });
	}
	const rows = await db()`UPDATE items SET shared = COALESCE(${value.shared ?? null}::boolean, shared),
		favorite = COALESCE(${value.favorite ?? null}::boolean, favorite), description = COALESCE(${value.description ?? null}::text, description), ocr_override = COALESCE(${value.extractedText ?? null}::text, ocr_override),
		tags = ARRAY(SELECT jsonb_array_elements_text(COALESCE(${value.tags === undefined ? null : JSON.stringify(value.tags)}::text::jsonb, to_jsonb(tags))))
		WHERE id = ${params.id} AND owner_id = ${locals.user.id} RETURNING id`;
	if (!rows.length) return new Response(null, { status: 404 });
	if (value.description !== undefined || value.tags !== undefined || value.extractedText !== undefined) {
		await db()`UPDATE items SET revision = revision + 1 WHERE id = ${params.id}`;
		await enqueueDocument(db(), params.id);
	}
	return new Response(null, { status: 204 });
};

export const DELETE: RequestHandler = async ({ locals, request, url, params }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!trustedOrigin(request, url)) return json({ error: 'Forbidden' }, { status: 403 });
	if (!validId(params.id)) return new Response(null, { status: 404 });
	try { await deleteItem(db(), storageFromEnv(), locals.user.id, params.id); }
	catch (error) { if (error instanceof Error && error.message === 'Item not found') return new Response(null, { status: 404 }); throw error; }
	return new Response(null, { status: 204 });
};
