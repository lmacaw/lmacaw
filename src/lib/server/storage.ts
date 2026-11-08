import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export interface Storage {
	put(key: string, bytes: Uint8Array): Promise<void>;
	get(key: string): Promise<Uint8Array>;
	delete(key: string): Promise<void>;
	/** Every stored media key with its last modification time. */
	list(): AsyncIterable<{ key: string; modified: Date }>;
}

function validateKey(key: string) {
	if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid storage key');
}

export class FileStorage implements Storage {
	constructor(private readonly root: string) {}

	private path(key: string): string {
		validateKey(key);
		return join(this.root, key);
	}

	async put(key: string, bytes: Uint8Array): Promise<void> {
		const target = this.path(key);
		await mkdir(this.root, { recursive: true });
		const temporary = join(this.root, `.${randomUUID()}.tmp`);
		try {
			await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
			await rename(temporary, target);
		} finally {
			await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
				if (error.code !== 'ENOENT') throw error;
			});
		}
	}

	async get(key: string): Promise<Uint8Array> {
		return readFile(this.path(key));
	}

	async delete(key: string): Promise<void> {
		await unlink(this.path(key)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
	}

	async *list(): AsyncIterable<{ key: string; modified: Date }> {
		const names = await readdir(this.root).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return [] as string[]; throw error; });
		for (const name of names) {
			if (!/^[a-f0-9]{64}$/.test(name)) continue;
			const info = await stat(join(this.root, name)).catch(() => null);
			if (info) yield { key: name, modified: info.mtime };
		}
	}
}

export class S3Storage implements Storage {
	constructor(private readonly client: S3Client, private readonly bucket: string) {}
	async put(key: string, bytes: Uint8Array): Promise<void> {
		validateKey(key); await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes }));
	}
	async get(key: string): Promise<Uint8Array> {
		validateKey(key);
		const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
		if (!result.Body) throw new Error('Object is empty');
		return result.Body.transformToByteArray();
	}
	async delete(key: string): Promise<void> {
		validateKey(key); await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
	}
	async *list(): AsyncIterable<{ key: string; modified: Date }> {
		let token: string | undefined;
		do {
			const page = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, ContinuationToken: token }));
			for (const object of page.Contents ?? []) if (object.Key && /^[a-f0-9]{64}$/.test(object.Key)) yield { key: object.Key, modified: object.LastModified ?? new Date() };
			token = page.IsTruncated ? page.NextContinuationToken : undefined;
		} while (token);
	}
}

let selectedStorage: Storage | undefined;
export function storageFromEnv(): Storage {
	if (selectedStorage) return selectedStorage;
	if (process.env.MEDIA_STORAGE === 's3') {
		const bucket = process.env.S3_BUCKET;
		if (!bucket || !process.env.S3_ENDPOINT || !process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY) throw new Error('S3 storage configuration is incomplete');
		const client = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION || 'auto', forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } });
		return selectedStorage = new S3Storage(client, bucket);
	}
	if (process.env.MEDIA_STORAGE && process.env.MEDIA_STORAGE !== 'filesystem') throw new Error('Invalid MEDIA_STORAGE');
	if (!process.env.MEDIA_ROOT) throw new Error('MEDIA_ROOT is required');
	return new FileStorage(process.env.MEDIA_ROOT);
}
