import { beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { resetAccessKeyCache, verifyAccessToken } from '$lib/server/access';

const env = { ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'lmacaw-admin' };
const time = 1_800_000_000;
const email = 'maintainer@example.com';
const claims = { iss: `https://${env.ACCESS_TEAM_DOMAIN}`, aud: env.ACCESS_AUD, exp: time + 300, email };
const encoder = new TextEncoder();
const keyId = 'current';
let signingKey: CryptoKeyPair;
let otherKey: CryptoKeyPair;
let publicJwk: JsonWebKey & { kid: string };

function generateKey() {
	return crypto.subtle.generateKey({
		name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', modulusLength: 2048,
		publicExponent: new Uint8Array([1, 0, 1])
	}, true, ['sign', 'verify']);
}

function base64Url(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function sign(overrides: Record<string, unknown> = {}, header = { alg: 'RS256', kid: keyId }, key = signingKey) {
	const encode = (value: object) => base64Url(encoder.encode(JSON.stringify(value)));
	const message = `${encode(header)}.${encode({ ...claims, ...overrides })}`;
	const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, encoder.encode(message));
	return `${message}.${base64Url(new Uint8Array(signature))}`;
}

const certs = () => vi.fn(async () => Response.json({ keys: [publicJwk] }));

beforeAll(async () => {
	[signingKey, otherKey] = await Promise.all([generateKey(), generateKey()]);
	publicJwk = { ...await crypto.subtle.exportKey('jwk', signingKey.publicKey), kid: keyId };
});

beforeEach(resetAccessKeyCache);

test('verifies RS256 with either audience format and caches the keys', async () => {
	const fetcher = certs();
	await expect(verifyAccessToken(await sign(), env, fetcher, time)).resolves.toEqual({ email });
	const token = await sign({ aud: ['other', env.ACCESS_AUD], exp: time - 59, nbf: time + 60, iat: time + 60 });
	await expect(verifyAccessToken(token, env, fetcher, time)).resolves.toEqual({ email });
	expect(fetcher).toHaveBeenCalledExactlyOnceWith(
		`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`, { redirect: 'manual' }
	);
});

test.each([
	['wrong audience', { aud: 'another-application' }],
	['wrong audience array', { aud: ['another-application'] }],
	['expired', { exp: time - 61 }],
	['missing expiration', { exp: undefined }],
	['nonnumeric expiration', { exp: String(time + 300) }],
	['wrong issuer', { iss: 'https://other.cloudflareaccess.com' }],
	['future not-before', { nbf: time + 61 }],
	['future issued-at', { iat: time + 61 }],
	['missing email', { email: undefined }],
	['empty email', { email: '' }]
])('rejects a signed token with %s', async (_name, overrides) => {
	const fetcher = certs();
	await expect(verifyAccessToken(await sign(overrides), env, fetcher, time)).resolves.toBeNull();
});

test('rejects a signature made by another private key with the same kid', async () => {
	const token = await sign({}, undefined, otherKey);
	await expect(verifyAccessToken(token, env, certs(), time)).resolves.toBeNull();
});

test.each(['none', 'HS256'])('rejects alg %s before fetching keys', async (alg) => {
	const fetcher = certs();
	const signed = await sign({}, { alg, kid: keyId });
	const token = alg === 'none' ? signed.slice(0, signed.lastIndexOf('.') + 1) : signed;
	await expect(verifyAccessToken(token, env, fetcher, time)).resolves.toBeNull();
	expect(fetcher).not.toHaveBeenCalled();
});

test('refetches once for an unknown kid and caches the rotated key', async () => {
	const rotated = { ...publicJwk, kid: 'rotated' };
	const fetcher = certs().mockImplementationOnce(async () => Response.json({ keys: [publicJwk] }))
		.mockImplementationOnce(async () => Response.json({ keys: [rotated] }));
	await expect(verifyAccessToken(await sign(), env, fetcher, time)).resolves.toEqual({ email });
	const token = await sign({}, { alg: 'RS256', kid: rotated.kid });
	await expect(verifyAccessToken(token, env, fetcher, time)).resolves.toEqual({ email });
	await expect(verifyAccessToken(token, env, fetcher, time)).resolves.toEqual({ email });
	expect(fetcher).toHaveBeenCalledTimes(2);
});

test('stops after one refetch if the kid is still unknown', async () => {
	const fetcher = certs();
	const token = await sign({}, { alg: 'RS256', kid: 'absent' });
	await expect(verifyAccessToken(token, env, fetcher, time)).resolves.toBeNull();
	expect(fetcher).toHaveBeenCalledTimes(2);
});

test('keeps each team domain in its own cache', async () => {
	const otherEnv = { ...env, ACCESS_TEAM_DOMAIN: 'other.cloudflareaccess.com' };
	const fetcher = certs();
	await expect(verifyAccessToken(await sign(), env, fetcher, time)).resolves.toEqual({ email });
	const token = await sign({ iss: `https://${otherEnv.ACCESS_TEAM_DOMAIN}` });
	await expect(verifyAccessToken(token, otherEnv, fetcher, time)).resolves.toEqual({ email });
	expect(fetcher).toHaveBeenCalledTimes(2);
});

test('handles garbage, missing config, and fetch or response failures', async () => {
	const fetcher = certs();
	const token = await sign();
	await expect(verifyAccessToken('garbage', env, fetcher, time)).resolves.toBeNull();
	await expect(verifyAccessToken(token, { ACCESS_AUD: env.ACCESS_AUD }, fetcher, time)).resolves.toBeNull();
	await expect(verifyAccessToken(token, { ACCESS_TEAM_DOMAIN: env.ACCESS_TEAM_DOMAIN }, fetcher, time)).resolves.toBeNull();
	expect(fetcher).not.toHaveBeenCalled();
	await expect(verifyAccessToken(token, env, fetcher.mockRejectedValueOnce(new Error('Offline')), time)).resolves.toBeNull();
	await expect(verifyAccessToken(token, env, async () => new Response('{'), time)).resolves.toBeNull();
	await expect(verifyAccessToken(token, env, async () => new Response(null, { status: 503 }), time)).resolves.toBeNull();
});
