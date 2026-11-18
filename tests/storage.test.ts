import { env } from 'cloudflare:test';
import { expect, test } from 'vitest';
import { mediaUrl } from '$lib/server/media-url';
import { copyObject, deleteObject, headBytes, newKey, putObject, validateKey } from '$lib/server/storage';

test('stores, reads, copies, and deletes R2 objects', async () => {
	const originalKey = newKey();
	const copyKey = newKey();
	const bytes = new TextEncoder().encode('storage round trip');
	await putObject(env.MEDIA, originalKey, bytes, 'image/png');
	expect(Array.from(await headBytes(env.MEDIA, originalKey, 6))).toEqual(Array.from(bytes.slice(0, 6)));
	await copyObject(env.MEDIA, originalKey, copyKey);
	const original = await env.MEDIA.get(originalKey);
	const copy = await env.MEDIA.get(copyKey);
	expect(await original?.text()).toBe('storage round trip');
	expect(await copy?.text()).toBe('storage round trip');
	expect(copy?.httpMetadata?.contentType).toBe('image/png');
	await deleteObject(env.MEDIA, originalKey);
	expect(await env.MEDIA.get(originalKey)).toBeNull();
	await deleteObject(env.MEDIA, copyKey);
});

test('generates unique lowercase hex keys and rejects invalid keys', () => {
	const first = newKey();
	const second = newKey();
	expect(first).toMatch(/^[a-f0-9]{64}$/);
	expect(second).not.toBe(first);
	expect(() => validateKey('../x')).toThrow('Invalid storage key');
	expect(() => validateKey('A'.repeat(64))).toThrow('Invalid storage key');
});

test('validates put keys before writing', async () => {
	await expect(putObject(env.MEDIA, '../x', new Uint8Array([1]), 'image/png')).rejects.toThrow('Invalid storage key');
});

test('presigns media only when R2 credentials are configured', async () => {
	const key = newKey();
	for (const missing of ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'] as const) {
		const incomplete = { ...env, R2_ACCOUNT_ID: 'acc', R2_BUCKET: 'b', R2_ACCESS_KEY_ID: 'id', R2_SECRET_ACCESS_KEY: 'secret', [missing]: undefined };
		expect(await mediaUrl(incomplete, key, 'image/png')).toBeNull();
	}

	const signed = await mediaUrl({
		...env,
		R2_ACCOUNT_ID: 'acc',
		R2_BUCKET: 'b',
		R2_ACCESS_KEY_ID: 'id',
		R2_SECRET_ACCESS_KEY: 'secret'
	}, key, 'image/png', 'a"b.png');
	expect(signed).not.toBeNull();
	const url = new URL(signed!);
	expect(url.host).toBe('acc.r2.cloudflarestorage.com');
	expect(url.pathname).toBe(`/b/${key}`);
	expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
	expect(url.searchParams.get('X-Amz-Expires')).toBe('600');
	expect(url.searchParams.get('response-content-type')).toBe('image/png');
	expect(url.searchParams.get('response-content-disposition')).toBe('attachment; filename="ab.png"');
});

test('stores a stream of declared length and rejects a wrong length', async () => {
	const key = newKey();
	const stream = () => new Blob([new Uint8Array([1, 2, 3, 4])]).stream();
	await putObject(env.MEDIA, key, stream(), 'image/png', 4);
	expect(await headBytes(env.MEDIA, key, 4)).toEqual(new Uint8Array([1, 2, 3, 4]));
	await expect(putObject(env.MEDIA, newKey(), stream(), 'image/png', 9)).rejects.toThrow();
});
