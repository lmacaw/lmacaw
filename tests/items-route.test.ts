import { env } from 'cloudflare:test';
import { beforeEach, expect, test, vi } from 'vitest';
import { GET, POST } from '../src/routes/api/v1/items/+server';
import { createCollection } from '$lib/server/collections';
import { eventFor, imageInput, itemsRoute, jpeg, listEvent, png, signedBindings, uploadEvent, uploadForm, user, mediaKeys } from './fixtures';

let keysBefore: string[] = [];
beforeEach(async () => {
	keysBefore = await mediaKeys();
});

test('requires authentication to list and upload', async () => {
	expect((await GET(listEvent(null))).status).toBe(401);
	expect((await POST(await uploadEvent(null))).status).toBe(401);
});

test('accepts multipart uploads, returns a public DTO and reuses a duplicate', async () => {
	const owner = await user();
	const input = imageInput({
		original: new File([png], 'pixel.jpg', { type: 'image/jpeg' }),
		thumbnail: new File([jpeg], 'pixel.webp', { type: 'image/webp' })
	});
	const response = await POST(await uploadEvent(owner, uploadForm(input)));
	expect(response.status).toBe(201);
	const payload = await response.json();
	expect(payload).toEqual({ duplicate: false, item: {
		id: expect.any(String), content_type: 'image/png', shared: false, favorite: false, description: '',
		tags: [], source_metadata: null, ai_description: null, extracted_text: null, suggested_tags: null, ai_state: 'pending'
	} });
	const duplicate = await POST(await uploadEvent(owner, uploadForm(input)));
	expect(duplicate.status).toBe(200);
	expect(await duplicate.json()).toEqual({ ...payload, duplicate: true });

	const list = await GET(listEvent(owner, '', signedBindings));
	expect(list.headers.get('cache-control')).toBe('private, no-store');
	// Lists carry no presigned URLs: they would expire while the page stays open.
	expect(await list.json()).toEqual({ items: [payload.item], semanticAvailable: false, hasMore: false });
});

test('adds new and duplicate uploads to the open collection, and rejects a foreign one before writing (#27)', async () => {
	const owner = await user();
	const other = await user();
	const cats = await createCollection(env.DB, owner.id, 'Cats');
	const foreign = await createCollection(env.DB, other.id, 'Private');
	const input = imageInput();
	const inCollection = (collection: string) => {
		const form = uploadForm(input);
		form.set('collection', collection);
		return form;
	};

	const invalid = await POST(await uploadEvent(owner, inCollection('invalid')));
	expect(invalid.status).toBe(400);
	expect(await invalid.json()).toEqual({ error: 'Invalid collection' });
	expect((await POST(await uploadEvent(owner, inCollection(foreign.id)))).status).toBe(404);
	expect(await mediaKeys()).toEqual(keysBefore);

	const created = await POST(await uploadEvent(owner, inCollection(cats.id.toUpperCase())));
	expect(created.status).toBe(201);
	const { item } = await created.json();
	const listed = async () => (await (await GET(listEvent(owner, `?collection=${cats.id}`))).json()).items.map(({ id }: { id: string }) => id);
	expect(await listed()).toEqual([item.id]);

	await env.DB.prepare('DELETE FROM collection_items WHERE collection_id = ?').bind(cats.id).run();
	const duplicate = await POST(await uploadEvent(owner, inCollection(cats.id)));
	expect(duplicate.status).toBe(200);
	expect(await listed()).toEqual([item.id]);
});

test.each([
	[undefined, 411, 'Length required'],
	[String(21 * 1024 * 1024 + 300 * 1024 + 1), 413, 'File too large'],
	['10x', 400, 'Invalid upload']
])('rejects content-length %s before parsing multipart', async (length, status, error) => {
	const actor = await user();
	const headers = length === undefined ? undefined : { 'content-length': length };
	const event = eventFor(itemsRoute, itemsRoute, actor, { method: 'POST', headers });
	const parse = vi.spyOn(event.request, 'formData');
	const response = await POST(event);
	expect(response.status).toBe(status);
	expect(await response.json()).toEqual({ error });
	expect(parse).not.toHaveBeenCalled();
});

test('rejects a cross-origin upload before parsing multipart', async () => {
	const event = eventFor(itemsRoute, itemsRoute, await user(), {
		method: 'POST', headers: { origin: 'https://other.example' }
	});
	expect((await POST(event)).status).toBe(403);
});

test.each([
	['file', '%PDF-1.7', 'Unsupported image format'],
	['thumbnail', png, 'Invalid thumbnail']
])('rejects mismatched %s bytes with no R2 writes', async (part, bytes, error) => {
	const owner = await user();
	const form = uploadForm();
	form.set(part, new Blob([bytes], { type: 'image/png' }), 'photo.png');
	const response = await POST(await uploadEvent(owner, form));
	expect(response.status).toBe(400);
	expect(await response.json()).toEqual({ error });
	expect(await mediaKeys()).toEqual(keysBefore);
});

test('records Openverse metadata from the server and indexes its title', async () => {
	const owner = await user();
	const id = crypto.randomUUID();
	const form = uploadForm();
	form.set('openverse', id);
	form.set('source_metadata', JSON.stringify({ creator: 'Untrusted' }));
	const fetcher = vi.fn().mockResolvedValue(Response.json({
		id, url: 'https://images.example/pixel.png', title: 'Chú mèo', creator: 'Verified creator',
		creator_url: 'https://images.example/creator', foreign_landing_url: 'https://images.example/source',
		license: 'cc0', license_url: 'https://creativecommons.org/publicdomain/zero/1.0/', attribution: 'Public domain'
	}));
	vi.stubGlobal('fetch', fetcher);
	try {
		const response = await POST(await uploadEvent(owner, form));
		expect(response.status).toBe(201);
		expect(fetcher).toHaveBeenCalledWith(`https://api.openverse.org/v1/images/${id}/`, expect.anything());
		const payload = await response.json();
		expect(payload.item.source_metadata).toEqual({
			source: 'https://images.example/source', title: 'Chú mèo', creator: 'Verified creator',
			creatorUrl: 'https://images.example/creator', license: 'cc0',
			licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', attribution: 'Public domain'
		});
		expect((await (await GET(listEvent(owner, '?q=chu+meo'))).json()).items)
			.toEqual([expect.objectContaining({ id: payload.item.id })]);
	} finally {
		vi.unstubAllGlobals();
	}
});

test('returns 400 without writing media when Openverse fails', async () => {
	const owner = await user();
	const form = uploadForm();
	form.set('openverse', crypto.randomUUID());
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
	try {
		expect((await POST(await uploadEvent(owner, form))).status).toBe(400);
		expect(await mediaKeys()).toEqual(keysBefore);
	} finally {
		vi.unstubAllGlobals();
	}
});
