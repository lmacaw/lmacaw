import { AwsClient } from 'aws4fetch';
import type { Env } from './env';
import { validateKey } from './storage';

/** Storage keys are random and never rewritten, so the bytes behind a URL never change. */
export const immutable = 'private, max-age=31536000, immutable';
/** Signatures are stamped with the start of the current hour and last two, so a cached redirect never outlives its target. */
export const signingWindow = 3600;

type Sign = (key: string, contentType?: string, filename?: string) => Promise<string>;

/** One client for many URLs, so a list signs its page with one derived signing key; null when signing is not configured. */
export function mediaSigner(env: Env, now = Date.now()): Sign | null {
	const { R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = env;
	if (!R2_ACCOUNT_ID || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return null;
	const client = new AwsClient({
		accessKeyId: R2_ACCESS_KEY_ID,
		secretAccessKey: R2_SECRET_ACCESS_KEY,
		service: 's3',
		region: 'auto'
	});
	// The same URL for a whole hour lets the browser reuse the bytes it already fetched instead of refetching per signature.
	const start = Math.floor(now / 1000 / signingWindow) * signingWindow * 1000;
	const datetime = new Date(start).toISOString().replace(/[:-]|\.\d{3}/g, '');

	return async (key, contentType, filename) => {
		validateKey(key);
		const url = new URL(`https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${key}`);
		url.searchParams.set('X-Amz-Expires', String(2 * signingWindow));
		url.searchParams.set('response-cache-control', immutable);
		if (contentType) url.searchParams.set('response-content-type', contentType);
		if (filename !== undefined) {
			const safeFilename = filename.replace(/["\\\x00-\x1f\x7f]/g, '');
			url.searchParams.set('response-content-disposition', `attachment; filename="${safeFilename}"`);
		}
		const signed = await client.sign(url, { method: 'GET', aws: { signQuery: true, datetime } });
		return signed.url;
	};
}

export async function mediaUrl(
	env: Env,
	key: string,
	contentType?: string,
	filename?: string,
	now = Date.now()
): Promise<string | null> {
	validateKey(key);
	return mediaSigner(env, now)?.(key, contentType, filename) ?? null;
}
