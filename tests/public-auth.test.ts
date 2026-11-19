import { env } from 'cloudflare:test';
import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { handle } from '../src/hooks.server';
import { resetAccessKeyCache } from '$lib/server/access';
import { createLoginLink, redeemLoginLink, upsertAccessAdmin } from '$lib/server/auth';
import { one, run } from '$lib/server/db';
import { requireRole } from '$lib/server/request';
import { POST as dev } from '../src/routes/api/v1/dev/login-link/+server';
import { POST as invitations } from '../src/routes/api/v1/invitations/+server';
import { POST as register } from '../src/routes/api/v1/register/+server';
import { POST as signIn, DELETE as signOut } from '../src/routes/api/v1/session/+server';
import { POST as link } from '../src/routes/api/v1/session/link/+server';
import { POST as setup } from '../src/routes/api/v1/setup/+server';
import { eventFor } from './fixtures';

const bindings = {
	AUTH_MODE: 'public',
	ADMIN_HOST: 'admin.lmacaw.meme',
	ACCESS_TEAM_DOMAIN: 'lmacaw.cloudflareaccess.com',
	ACCESS_AUD: 'admin-aud',
	DEV_ENDPOINTS: 'on',
	RESEND_API_KEY: 'test-key'
};
const email = 'maintainer@example.com';
const encoder = new TextEncoder();
let signingKey: CryptoKeyPair;
let otherKey: CryptoKeyPair;
let publicJwk: JsonWebKey & { kid: string };

function generateKey() {
	return crypto.subtle.generateKey({
		name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', modulusLength: 2048,
		publicExponent: new Uint8Array([1, 0, 1])
	}, true, ['sign', 'verify']);
}

function base64Url(bytes: Uint8Array) {
	return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function token(overrides: Record<string, unknown> = {}, key = signingKey) {
	const encode = (value: object) => base64Url(encoder.encode(JSON.stringify(value)));
	const header = encode({ alg: 'RS256', kid: publicJwk.kid });
	const payload = encode({
		email, iss: `https://${bindings.ACCESS_TEAM_DOMAIN}`, aud: bindings.ACCESS_AUD,
		exp: Math.floor(Date.now() / 1000) + 300, ...overrides
	});
	const signed = `${header}.${payload}`;
	const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, encoder.encode(signed));
	return `${signed}.${base64Url(new Uint8Array(signature))}`;
}

function hookEvent(host = bindings.ADMIN_HOST, assertion?: string, cookie?: string, mode = 'public') {
	const url = new URL(`https://${host}/`);
	const request = new Request(url, { headers: assertion ? { 'Cf-Access-Jwt-Assertion': assertion } : {} });
	return {
		url, request, locals: {}, cookies: { get: vi.fn(() => cookie) },
		platform: { env: { ...env, ...bindings, AUTH_MODE: mode } }
	} as unknown as RequestEvent;
}

const resolve = async () => new Response(null, { status: 204 });

beforeAll(async () => {
	[signingKey, otherKey] = await Promise.all([generateKey(), generateKey()]);
	publicJwk = { ...await crypto.subtle.exportKey('jwk', signingKey.publicKey), kid: 'access' };
});

beforeEach(() => {
	resetAccessKeyCache();
	vi.stubGlobal('fetch', vi.fn(async () => Response.json({ keys: [publicJwk] })));
});

afterEach(() => vi.unstubAllGlobals());

test('a valid Access JWT on ADMIN_HOST inserts and promotes an administrator with a stable user ID', async () => {
	const assertion = await token();
	const event = hookEvent(bindings.ADMIN_HOST, assertion);
	await handle({ event, resolve });
	const admin = event.locals.user;
	expect(admin).toMatchObject({ email, isAdmin: true });
	expect(await one(env.DB, 'SELECT id, is_admin, password_hash FROM users WHERE email = ?', email))
		.toEqual({ id: admin!.id, is_admin: 1, password_hash: null });

	await run(env.DB, 'UPDATE users SET is_admin = 0 WHERE id = ?', admin!.id);
	const next = hookEvent(bindings.ADMIN_HOST, assertion);
	await handle({ event: next, resolve });
	expect(next.locals.user).toEqual(admin);
	expect(await one(env.DB, 'SELECT is_admin FROM users WHERE id = ?', admin!.id)).toEqual({ is_admin: 1 });
});

test('the main host ignores even a valid Access token', async () => {
	const address = 'ignored@example.com';
	const event = hookEvent('lmacaw.meme', await token({ email: address }));
	await handle({ event, resolve });
	expect(event.locals.user).toBeNull();
	expect(fetch).not.toHaveBeenCalled();
	expect(await one(env.DB, 'SELECT id FROM users WHERE email = ?', address)).toBeNull();
});

test.each(['missing', 'expired', 'wrong-audience', 'wrong-signature'])(
	'an admin-host request with a %s Access JWT cannot write', async (kind) => {
		const assertion = kind === 'missing' ? undefined : await token({
			...(kind === 'expired' && { exp: Math.floor(Date.now() / 1000) - 120 }),
			...(kind === 'wrong-audience' && { aud: 'a-different-app' })
		}, kind === 'wrong-signature' ? otherKey : signingKey);
		const event = hookEvent(bindings.ADMIN_HOST, assertion);
		const response = await handle({
			event,
			resolve: async (resolved) => requireRole(resolved, 'member', bindings) as Response
		});
		expect(event.locals.user).toBeNull();
		expect(response.status).toBe(403);
	}
);

test('public mode ignores an existing session cookie and password mode still accepts it', async () => {
	const admin = await upsertAccessAdmin(env.DB, 'session@example.com');
	const loginLink = await createLoginLink(env.DB, admin.email, null);
	const session = await redeemLoginLink(env.DB, loginLink!);
	expect(session).toBeTruthy();
	const privateEvent = hookEvent(bindings.ADMIN_HOST, undefined, session!, 'password');
	await handle({ event: privateEvent, resolve });
	expect(privateEvent.locals.user).toEqual(admin);

	for (const host of ['lmacaw.meme', bindings.ADMIN_HOST]) {
		const event = hookEvent(host, undefined, session!);
		await handle({ event, resolve });
		expect(event.locals.user).toBeNull();
		expect(event.cookies.get).not.toHaveBeenCalled();
	}
});

test('the hook sets an anonymous caller when platform bindings are unavailable', async () => {
	const event = hookEvent(bindings.ADMIN_HOST);
	event.platform = undefined;
	await handle({ event, resolve });
	expect(event.locals.user).toBeNull();
});

function publicRoute<Path extends NonNullable<RequestEvent['route']['id']>>(path: Path, method = 'POST') {
	return eventFor(path, `https://${bindings.ADMIN_HOST}${path}`, { id: 'admin', email, isAdmin: true }, {
		method, headers: { origin: 'https://untrusted.example' },
		body: method === 'POST' ? 'malformed' : undefined
	}, undefined, bindings);
}

test.each([
	['POST /session', () => signIn(publicRoute('/api/v1/session'))],
	['DELETE /session', () => signOut(publicRoute('/api/v1/session', 'DELETE'))],
	['POST /setup', () => setup(publicRoute('/api/v1/setup'))],
	['POST /register', () => register(publicRoute('/api/v1/register'))],
	['POST /invitations', () => invitations(publicRoute('/api/v1/invitations'))],
	['POST /session/link', () => link(publicRoute('/api/v1/session/link'))],
	['POST /dev/login-link', () => dev(publicRoute('/api/v1/dev/login-link'))]
] as const)('%s returns 404 in public mode before processing the request', async (_route, request) => {
	expect((await request()).status).toBe(404);
	expect(fetch).not.toHaveBeenCalled();
});
