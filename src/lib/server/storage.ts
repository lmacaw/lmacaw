import type { FixedLengthStream as FixedLengthStreamType, R2Bucket } from '@cloudflare/workers-types';

// A Workers global that the DOM lib types do not declare.
declare const FixedLengthStream: typeof FixedLengthStreamType;

export function newKey(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function validateKey(key: string): void {
	if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid storage key');
}

export async function putObject(
	bucket: R2Bucket,
	key: string,
	body: ReadableStream | ArrayBuffer | Uint8Array,
	contentType: string,
	length?: number
): Promise<void> {
	validateKey(key);
	// R2 rejects streams of unknown length (such as a request body), so a stream with a declared
	// length is piped through FixedLengthStream, which also fails if the byte count differs.
	let value: unknown = body;
	if (body instanceof ReadableStream && length !== undefined) {
		const fixed = new FixedLengthStream(length);
		body.pipeTo(fixed.writable as unknown as WritableStream).catch(() => {});
		value = fixed.readable;
	}
	await bucket.put(key, value as any, { httpMetadata: { contentType } });
}

export async function headBytes(bucket: R2Bucket, key: string, n = 16): Promise<Uint8Array> {
	validateKey(key);
	const object = await bucket.get(key, { range: { offset: 0, length: n } });
	if (!object) throw new Error('Missing object');
	return object.bytes();
}

export async function copyObject(bucket: R2Bucket, from: string, to: string): Promise<void> {
	validateKey(from);
	validateKey(to);
	const object = await bucket.get(from);
	if (!object) throw new Error('Missing object');
	await bucket.put(to, object.body as any, {
		httpMetadata: object.httpMetadata?.contentType
			? { contentType: object.httpMetadata.contentType }
			: undefined
	});
}

export async function deleteObject(bucket: R2Bucket, key: string): Promise<void> {
	validateKey(key);
	await bucket.delete(key);
}
