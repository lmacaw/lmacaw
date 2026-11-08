import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStorage, S3Storage } from '../src/lib/server/storage';
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const root = await mkdtemp(join(tmpdir(), 'lmacaw-storage-test-'));
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

test('writes, reads and deletes a file', async () => {
	const storage = new FileStorage(root);
	const key = 'a'.repeat(64);
	await storage.put(key, new TextEncoder().encode('test'));
	expect(new TextDecoder().decode(await storage.get(key))).toBe('test');
	const listed = []; for await (const entry of storage.list()) listed.push(entry.key);
	expect(listed).toEqual([key]);
	await storage.delete(key);
	await expect(storage.get(key)).rejects.toThrow();
});

test('rejects paths outside the storage directory', async () => {
	const storage = new FileStorage(root);
	await expect(storage.put('../outside', new Uint8Array())).rejects.toThrow();
	await expect(storage.get('../outside')).rejects.toThrow();
	await expect(storage.delete('../outside')).rejects.toThrow();
});

test('S3 storage writes, reads, and deletes the configured object', async () => {
	const commands: unknown[] = [];
	const client = { send: async (command: unknown) => { commands.push(command); return { Body: { transformToByteArray: async () => Uint8Array.from([1, 2]) } }; } };
	const storage = new S3Storage(client as never, 'private-bucket');
	const key = 'b'.repeat(64);
	await storage.put(key, Uint8Array.from([1, 2]));
	expect(await storage.get(key)).toEqual(Uint8Array.from([1, 2]));
	await storage.delete(key);
	expect(commands[0]).toBeInstanceOf(PutObjectCommand);
	expect(commands[1]).toBeInstanceOf(GetObjectCommand);
	expect(commands[2]).toBeInstanceOf(DeleteObjectCommand);
	expect((commands[0] as PutObjectCommand).input).toMatchObject({ Bucket: 'private-bucket', Key: key });
});
