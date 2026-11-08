import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { CreateBucketCommand, DeleteBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { S3Storage } from '../src/lib/server/storage';

test.skipIf(!process.env.TEST_S3_ENDPOINT)('stores and retrieves bytes from an S3-compatible server', async () => {
	const client = new S3Client({ endpoint: process.env.TEST_S3_ENDPOINT, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });
	const bucket = `lmacaw-test-${randomUUID()}`;
	await client.send(new CreateBucketCommand({ Bucket: bucket }));
	const storage = new S3Storage(client, bucket);
	const key = 'f'.repeat(64);
	try {
		await storage.put(key, Uint8Array.from([1, 2, 3]));
		expect(await storage.get(key)).toEqual(Uint8Array.from([1, 2, 3]));
		const listed = []; for await (const entry of storage.list()) listed.push(entry.key);
		expect(listed).toEqual([key]);
		await storage.delete(key);
		await expect(storage.get(key)).rejects.toThrow();
	} finally { await client.send(new DeleteBucketCommand({ Bucket: bucket })); client.destroy(); }
}, 15000);
