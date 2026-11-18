import { AwsClient } from 'aws4fetch';
import type { Env } from './env';
import { validateKey } from './storage';

export async function mediaUrl(
	env: Env,
	key: string,
	contentType: string,
	filename?: string
): Promise<string | null> {
	validateKey(key);
	const { R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = env;
	if (!R2_ACCOUNT_ID || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return null;

	const url = new URL(`https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${key}`);
	url.searchParams.set('X-Amz-Expires', '600');
	url.searchParams.set('response-content-type', contentType);
	if (filename !== undefined) {
		const safeFilename = filename.replace(/["\\\x00-\x1f\x7f]/g, '');
		url.searchParams.set('response-content-disposition', `attachment; filename="${safeFilename}"`);
	}
	const client = new AwsClient({
		accessKeyId: R2_ACCESS_KEY_ID,
		secretAccessKey: R2_SECRET_ACCESS_KEY,
		service: 's3',
		region: 'auto'
	});
	const signed = await client.sign(url, { method: 'GET', aws: { signQuery: true } });
	return signed.url;
}
