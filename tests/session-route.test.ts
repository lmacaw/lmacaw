import { env } from 'cloudflare:test';
import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, expect, test, vi } from 'vitest';
import { authenticate, createLoginLink, type User } from '$lib/server/auth';
import type { Env } from '$lib/server/env';
import { POST as createDevLink } from '../src/routes/api/v1/dev/login-link/+server';
import { POST as createInvitation } from '../src/routes/api/v1/invitations/+server';
import * as session from '../src/routes/api/v1/session/+server';
import { POST as requestLink } from '../src/routes/api/v1/session/link/+server';

const emailAddress = () => `${crypto.randomUUID()}@example.com`;
const localOrigin = 'http://localhost:4173';
type Route = NonNullable<RequestEvent['route']['id']>;

function eventFor<Path extends Route>(path: Path, body: unknown, options: {
	method?: 'POST' | 'DELETE';
	origin?: string;
	base?: string;
	ip?: string;
	bindings?: Partial<Env>;
	user?: User;
	cookie?: string;
} = {}) {
	const url = new URL(path, options.base ?? localOrigin);
	const request = new Request(url, {
		method: options.method ?? 'POST',
		headers: {
			'content-type': 'application/json',
			origin: options.origin ?? url.origin,
			'CF-Connecting-IP': options.ip ?? `test-${crypto.randomUUID()}`
		},
		body: JSON.stringify(body)
	});
	const cookies = { get: () => options.cookie, set: vi.fn(), delete: vi.fn() };
	const event = {
		request, url, cookies, locals: { user: options.user ?? null }, route: { id: path },
		platform: { env: { ...env, RESEND_API_KEY: undefined, DEV_ENDPOINTS: undefined, ...options.bindings } }
	} as unknown as RequestEvent<Record<string, never>, Path>;
	return { event, cookies };
}

function crossOriginEvent<Path extends Route>(path: Path, method: 'POST' | 'DELETE' = 'POST') {
	return eventFor(path, undefined, { method, origin: 'https://evil.example' }).event;
}

afterEach(() => vi.restoreAllMocks());

test('accepts a link request for an unknown email without sending an email', async () => {
	const log = vi.spyOn(console, 'log').mockImplementation(() => {});
	const { event } = eventFor('/api/v1/session/link', { email: emailAddress() });
	expect((await requestLink(event)).status).toBe(202);
	expect(log).not.toHaveBeenCalled();
});

test('emails the sign-in link at the first configured origin', async () => {
	const log = vi.spyOn(console, 'log').mockImplementation(() => {});
	const email = emailAddress();
	const { event } = eventFor('/api/v1/session/link', { email }, {
		bindings: { ADMIN_EMAIL: email, ORIGIN: ' https://primary.example , http://localhost:4173' }
	});
	expect((await requestLink(event)).status).toBe(202);
	expect(log).toHaveBeenCalledTimes(1);
	const message = log.mock.calls[0].join('\n');
	expect(message).toContain('Sign in to Lmacaw');
	expect(message).toMatch(/Open this link to sign in to Lmacaw\. It works once and expires in 15 minutes\.\n\nhttps:\/\/primary\.example\/signin#[A-Za-z0-9_-]{43}\n\nIf you did not ask for it, ignore this email\./);
});

test('rate-limits the eleventh request for the same email across addresses', async () => {
	const email = emailAddress();
	for (let attempt = 0; attempt < 10; attempt++) {
		const { event } = eventFor('/api/v1/session/link', { email });
		expect((await requestLink(event)).status).toBe(202);
	}
	const { event } = eventFor('/api/v1/session/link', { email: ` ${email.toUpperCase()} ` });
	expect((await requestLink(event)).status).toBe(429);
});

test('rate-limits the eleventh request from the same address across emails', async () => {
	const ip = `test-${crypto.randomUUID()}`;
	for (let attempt = 0; attempt < 10; attempt++) {
		const { event } = eventFor('/api/v1/session/link', { email: emailAddress() }, { ip });
		expect((await requestLink(event)).status).toBe(202);
	}
	const { event } = eventFor('/api/v1/session/link', { email: emailAddress() }, { ip });
	expect((await requestLink(event)).status).toBe(429);
});

test.each([
	['POST /api/v1/session/link', () => requestLink(crossOriginEvent('/api/v1/session/link'))],
	['POST /api/v1/session', () => session.POST(crossOriginEvent('/api/v1/session'))],
	['DELETE /api/v1/session', () => session.DELETE(crossOriginEvent('/api/v1/session', 'DELETE'))],
	['POST /api/v1/invitations', () => createInvitation(crossOriginEvent('/api/v1/invitations'))],
	['POST /api/v1/dev/login-link', () => createDevLink(crossOriginEvent('/api/v1/dev/login-link'))]
] as const)('rejects cross-origin %s before processing the request', async (_route, handleRequest) => {
	const response = await handleRequest();
	expect(response.status).toBe(403);
	expect(await response.json()).toEqual({ error: 'Forbidden' });
});

test.each([{}, { email: 'invalid' }, { email: 'valid@example.com', invitation: 0 }])(
	'rejects a malformed link request (%j)', async (body) => {
		const { event } = eventFor('/api/v1/session/link', body);
		expect((await requestLink(event)).status).toBe(400);
	}
);

test('exposes no GET handler that can consume a token', () => {
	expect(session).not.toHaveProperty('GET');
});

test.each([
	[localOrigin, false],
	['https://app.example', true]
])('sets the session cookie for %s and removes it on logout', async (base, secure) => {
	const email = emailAddress();
	const token = await createLoginLink(env.DB, email, null, email);
	expect(token).toBeTruthy();
	const { event, cookies } = eventFor('/api/v1/session', { token }, {
		base, bindings: { ADMIN_EMAIL: email }
	});
	expect((await session.POST(event)).status).toBe(204);
	expect(cookies.set).toHaveBeenCalledWith(
		'lmacaw_session', expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
		{ path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: 30 * 86400 }
	);
	const sessionToken = cookies.set.mock.calls[0][1];
	expect(await authenticate(env.DB, sessionToken)).toMatchObject({ email });
	const logout = eventFor('/api/v1/session', undefined, { method: 'DELETE', base, cookie: sessionToken });
	expect((await session.DELETE(logout.event)).status).toBe(204);
	expect(logout.cookies.delete).toHaveBeenCalledWith('lmacaw_session', { path: '/', secure });
	expect(await authenticate(env.DB, sessionToken)).toBeNull();
});

test('rejects an invalid session token without setting a cookie', async () => {
	const { event, cookies } = eventFor('/api/v1/session', { token: 'invalid' });
	expect((await session.POST(event)).status).toBe(400);
	expect(cookies.set).not.toHaveBeenCalled();
});

test('restricts invitation creation to administrators and returns the invitation URL', async () => {
	const path = '/api/v1/invitations';
	expect((await createInvitation(eventFor(path, undefined).event)).status).toBe(401);
	const member = { id: crypto.randomUUID(), email: emailAddress(), isAdmin: false };
	expect((await createInvitation(eventFor(path, undefined, { user: member }).event)).status).toBe(403);

	const email = emailAddress();
	const link = await createLoginLink(env.DB, email, null, email);
	const value = await session.POST(eventFor('/api/v1/session', { token: link }, { bindings: { ADMIN_EMAIL: email } }).event);
	expect(value.status).toBe(204);
	const admin = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>();
	const response = await createInvitation(eventFor(path, undefined, { user: { id: admin!.id, email, isAdmin: true } }).event);
	expect(response.status).toBe(201);
	expect(response.headers.get('cache-control')).toBe('no-store');
	const body = await response.json() as { url: string; token: string };
	expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
	expect(body.url).toBe(`${localOrigin}/invite#${body.token}`);
});

test('hides the dev route unless enabled and returns tokens only for eligible addresses', async () => {
	const path = '/api/v1/dev/login-link';
	const email = emailAddress();
	const disabled = eventFor(path, { email }, { bindings: { ADMIN_EMAIL: email } });
	expect((await createDevLink(disabled.event)).status).toBe(404);

	const bindings = { DEV_ENDPOINTS: 'on', ADMIN_EMAIL: email };
	const unknown = eventFor(path, { email: emailAddress() }, { bindings });
	const missing = await createDevLink(unknown.event);
	expect(missing.status).toBe(404);
	expect(await missing.json()).toHaveProperty('error');

	const enabled = eventFor(path, { email }, { bindings });
	const response = await createDevLink(enabled.event);
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
});
