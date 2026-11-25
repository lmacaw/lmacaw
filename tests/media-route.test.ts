import { expect, test } from 'vitest';
import type { User } from '$lib/server/auth';
import { updateItem } from '$lib/server/library';
import type { Env } from '$lib/server/env';
import { GET } from '../src/routes/api/v1/items/[id]/media/+server';
import { createTestItem, eventFor, jpeg, png, signedBindings, unsignedEnv, user } from './fixtures';

function media(actor: User | null, id: string, query = '', bindings?: Partial<Env>) {
	return GET(eventFor('/api/v1/items/[id]/media', `/api/v1/items/${id}/media${query}`, actor, undefined, id, bindings));
}

test('checks authorization before streaming or signing media', async () => {
	const owner = await user();
	const other = await user();
	const { item } = await createTestItem(owner);
	expect((await media(null, item.id)).status).toBe(401);
	expect((await media(other, item.id)).status).toBe(404);
	const privateResponse = await media(other, item.id, '?size=thumbnail', signedBindings);
	expect(privateResponse.status).toBe(404);
	expect(privateResponse.headers.get('location')).toBeNull();
	await updateItem(unsignedEnv, owner.id, item.id, { shared: true });
	expect((await media(other, item.id)).status).toBe(200);
});

test('streams original and thumbnail bytes with sniffed types and download filenames', async () => {
	const owner = await user();
	const { item } = await createTestItem(owner, { thumbnail: new File([jpeg], 'photo.webp', { type: 'image/webp' }) });
	const original = await media(owner, item.id, '?download=1');
	expect(original.status).toBe(200);
	expect(original.headers.get('content-type')).toBe('image/png');
	expect(original.headers.get('content-disposition')).toBe(`attachment; filename="lmacaw-${item.id.slice(0, 8)}.png"`);
	expect(original.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
	expect(await original.bytes()).toEqual(png);

	const thumbnail = await media(owner, item.id, '?size=thumbnail');
	expect(thumbnail.status).toBe(200);
	expect(thumbnail.headers.get('content-type')).toBe('image/jpeg');
	expect(thumbnail.headers.get('content-disposition')).toBeNull();
	expect(await thumbnail.bytes()).toEqual(jpeg);
});

test('redirects to signed URLs: thumbnails keep their stored type, downloads name the original', async () => {
	const owner = await user();
	const { item } = await createTestItem(owner);
	const thumbnail = await media(owner, item.id, '?size=thumbnail', signedBindings);
	expect(thumbnail.status).toBe(302);
	expect(thumbnail.headers.get('cache-control')).toBe('private, max-age=3600');
	const thumbnailTarget = new URL(thumbnail.headers.get('location')!);
	expect(thumbnailTarget.host).toBe('account.r2.cloudflarestorage.com');
	expect(thumbnailTarget.pathname).toBe(`/media/${item.thumbnailKey}`);
	expect(thumbnailTarget.searchParams.get('X-Amz-Signature')).toBeTruthy();
	expect(thumbnailTarget.searchParams.get('response-content-type')).toBeNull();

	const download = await media(owner, item.id, '?download=1', signedBindings);
	const downloadTarget = new URL(download.headers.get('location')!);
	expect(downloadTarget.pathname).toBe(`/media/${item.storageKey}`);
	expect(downloadTarget.searchParams.get('response-content-type')).toBe('image/png');
	expect(downloadTarget.searchParams.get('response-content-disposition')).toBe(`attachment; filename="lmacaw-${item.id.slice(0, 8)}.png"`);
});
