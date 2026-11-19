import { env } from 'cloudflare:test';
import { expect, test } from 'vitest';
import type { User } from '$lib/server/auth';
import type { Env } from '$lib/server/env';
import { load } from '../src/routes/+page.server';
import { eventFor, user } from './fixtures';

function loadPage(actor: User | null, bindings: Partial<Env> = {}) {
	return load({
		...eventFor('/', '/', actor, undefined, undefined, {
			AUTH_MODE: undefined,
			RESEND_API_KEY: undefined,
			...bindings
		}),
		parent: async () => ({ mode: (bindings.AUTH_MODE === 'public' ? 'public' : 'password') as 'public' | 'password' }),
		depends: () => {},
		untrack: (fn) => fn()
	});
}

test('returns the page data for an anonymous public visitor', async () => {
	expect(await loadPage(null, { AUTH_MODE: 'public' })).toStrictEqual({
		user: null, mode: 'public', isAdmin: false, needsSetup: false, mailEnabled: false, aiEnabled: true
	});
});

test('returns the page data for an Access administrator', async () => {
	const admin = { id: 'access-admin', email: 'admin@example.com', isAdmin: true };
	expect(await loadPage(admin, { AUTH_MODE: 'public' })).toStrictEqual({
		user: admin, mode: 'public', isAdmin: true, needsSetup: false, mailEnabled: false, aiEnabled: true
	});
});

test('requires setup when password mode has no users', async () => {
	expect(await loadPage(null, { AUTH_MODE: 'password' })).toStrictEqual({
		user: null, mode: 'password', isAdmin: false, needsSetup: true, mailEnabled: false, aiEnabled: true
	});
});

test('skips setup once a user exists even when signed out', async ({ onTestFinished }) => {
	const member = await user();
	onTestFinished(async () => {
		await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(member.id).run();
	});
	const expected = {
		user: null, mode: 'password', isAdmin: false, needsSetup: false, mailEnabled: false, aiEnabled: true
	};
	expect(await loadPage(null)).toStrictEqual(expected);
	expect(await loadPage(member)).toStrictEqual({ ...expected, user: member });
});

test('enables mail when RESEND_API_KEY is set', async () => {
	expect(await loadPage(null, { RESEND_API_KEY: 'test-key' })).toStrictEqual({
		user: null, mode: 'password', isAdmin: false, needsSetup: true, mailEnabled: true, aiEnabled: true
	});
});
