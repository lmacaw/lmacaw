import type { Env } from './env';

type AccessKey = JsonWebKey & { kid: string };

const keyCache = new Map<string, Map<string, AccessKey>>();
const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
const skew = 60;
const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();

export function resetAccessKeyCache(): void {
	keyCache.clear();
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
	if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url');
	return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0));
}

async function fetchKeys(domain: string, fetcher: typeof fetch): Promise<Map<string, AccessKey>> {
	const response = await fetcher(`https://${domain}/cdn-cgi/access/certs`, { redirect: 'error' });
	if (!response.ok) throw new Error('Unable to fetch Access keys');

	const body = await response.json() as { keys?: AccessKey[] };
	if (!Array.isArray(body.keys)) throw new Error('Invalid Access keys');
	const keys = new Map<string, AccessKey>();
	for (const key of body.keys) {
		if (key?.kty === 'RSA' && typeof key.kid === 'string' && key.kid) keys.set(key.kid, key);
	}
	keyCache.set(domain, keys);
	return keys;
}

export async function verifyAccessToken(
	token: string,
	env: Pick<Env, 'ACCESS_TEAM_DOMAIN' | 'ACCESS_AUD'>,
	fetcher = fetch,
	nowSeconds = Date.now() / 1000
): Promise<{ email: string } | null> {
	const { ACCESS_TEAM_DOMAIN: domain, ACCESS_AUD: audience } = env;
	if (!domain || !audience) return null;

	try {
		const parts = token.split('.');
		if (parts.length !== 3) return null;
		const [encodedHeader, encodedPayload, encodedSignature] = parts;
		const header = JSON.parse(decoder.decode(decodeBase64Url(encodedHeader)));
		if (header?.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) return null;

		const claims = JSON.parse(decoder.decode(decodeBase64Url(encodedPayload)));
		if (!claims || claims.iss !== `https://${domain}`) return null;
		if (!(claims.aud === audience || (Array.isArray(claims.aud) && claims.aud.includes(audience)))) return null;
		if (!Number.isFinite(claims.exp) || claims.exp <= nowSeconds - skew) return null;
		for (const time of [claims.nbf, claims.iat]) {
			if (time !== undefined && (!Number.isFinite(time) || time > nowSeconds + skew)) return null;
		}
		if (typeof claims.email !== 'string' || !claims.email.trim()) return null;

		const signature = decodeBase64Url(encodedSignature);
		const keys = keyCache.get(domain) ?? await fetchKeys(domain, fetcher);
		const jwk = keys.get(header.kid) ?? (await fetchKeys(domain, fetcher)).get(header.kid);
		if (!jwk) return null;

		const key = await crypto.subtle.importKey('jwk', jwk, algorithm, false, ['verify']);
		const signed = encoder.encode(`${encodedHeader}.${encodedPayload}`);
		return await crypto.subtle.verify(algorithm, key, signature, signed) ? { email: claims.email } : null;
	} catch {
		return null;
	}
}
