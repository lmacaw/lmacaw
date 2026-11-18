import { env } from 'cloudflare:test';
import { expect, test, vi } from 'vitest';
import { authenticate, createInvitation, createLoginLink, normalizeEmail, redeemLoginLink } from '$lib/server/auth';
import { many, now, one, run } from '$lib/server/db';

const db = env.DB;
const address = () => `${crypto.randomUUID()}@example.com`;

async function adminLink(email: string): Promise<string> {
	const token = await createLoginLink(db, email, null, email);
	if (!token) throw new Error('Expected an administrator link');
	return token;
}

async function memberLink(email: string, invitation: string): Promise<string> {
	const token = await createLoginLink(db, email, invitation, undefined);
	if (!token) throw new Error('Expected an invitation link');
	return token;
}

async function invitationForTest(): Promise<string> {
	const email = address();
	const session = await redeemLoginLink(db, await adminLink(email), email);
	const admin = session && await authenticate(db, session);
	if (!admin) throw new Error('Expected an administrator session');
	return createInvitation(db, admin.id);
}

test('normalizes email and rejects invalid addresses', () => {
	expect(normalizeEmail(' A@B.co ')).toBe('a@b.co');
	expect(() => normalizeEmail('not-an-email')).toThrow('Invalid email');
});

test('returns no link for an unknown email', async () => {
	await expect(createLoginLink(db, address(), null, undefined)).resolves.toBeNull();
});

test('stores a SHA-256 digest of a 43-character administrator link', async () => {
	const email = address();
	const token = await adminLink(email);
	expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
	const row = await one<{ token_hash: string }>(db, 'SELECT token_hash FROM login_links WHERE email = ?', email);
	expect(row?.token_hash).toMatch(/^[a-f0-9]{64}$/);
	expect(row?.token_hash).not.toBe(token);
});

test('creates an administrator and authenticates their session', async () => {
	const email = address();
	const adminEmail = email.toUpperCase();
	const token = await createLoginLink(db, email, null, adminEmail);
	expect(token).toBeTruthy();
	const session = await redeemLoginLink(db, token!, adminEmail);
	expect(session).toMatch(/^[A-Za-z0-9_-]{43}$/);
	await expect(authenticate(db, session!)).resolves.toMatchObject({ email, isAdmin: true });

	const nextLink = await createLoginLink(db, email, null, undefined);
	expect(nextLink).toBeTruthy();
	const nextSession = await redeemLoginLink(db, nextLink!);
	expect(nextSession).toBeTruthy();
	expect(await authenticate(db, nextSession!)).toEqual(await authenticate(db, session!));
});

test('redeems a login link only once', async () => {
	const email = address();
	const token = await adminLink(email);
	expect(await redeemLoginLink(db, token, email)).toBeTruthy();
	await expect(redeemLoginLink(db, token, email)).resolves.toBeNull();
});

test('issues only one session for concurrent claims of the same link', async () => {
	const email = address();
	const token = await adminLink(email);
	const clock = vi.spyOn(Date, 'now').mockReturnValue(now());
	try {
		const results = await Promise.all([
			redeemLoginLink(db, token, email),
			redeemLoginLink(db, token, email)
		]);
		expect(results.filter(Boolean)).toHaveLength(1);
	} finally {
		clock.mockRestore();
	}
});

test('rejects a link created more than fifteen minutes ago', async () => {
	const email = address();
	const token = await adminLink(email);
	await run(db, 'UPDATE login_links SET expires_at = expires_at - ? WHERE email = ?', 16 * 60_000, email);
	await expect(redeemLoginLink(db, token, email)).resolves.toBeNull();
});

test('creates a member and marks the invitation used when redeeming the login link', async () => {
	const invitation = await invitationForTest();
	const email = address();
	const token = await memberLink(email, invitation);
	const invitationState = () => one<{ used_at: number | null }>(db, `
		SELECT i.used_at FROM invitations i JOIN login_links l ON l.invitation_hash = i.token_hash
		WHERE l.email = ?
	`, email);
	expect(await invitationState()).toEqual({ used_at: null });
	const session = await redeemLoginLink(db, token);
	expect(session).toBeTruthy();
	await expect(authenticate(db, session!)).resolves.toMatchObject({ email, isAdmin: false });
	expect((await invitationState())?.used_at).toBeGreaterThan(0);
	await expect(createLoginLink(db, address(), invitation, undefined)).resolves.toBeNull();
});

test('only one of two concurrent links sharing an invitation can create a user', async () => {
	const invitation = await invitationForTest();
	const firstEmail = address();
	const secondEmail = address();
	const first = await memberLink(firstEmail, invitation);
	const second = await memberLink(secondEmail, invitation);
	const results = await Promise.all([redeemLoginLink(db, first), redeemLoginLink(db, second)]);
	expect(results.filter(Boolean)).toHaveLength(1);
	const winner = results[0] ? firstEmail : secondEmail;
	const loser = results[0] ? second : first;
	expect(await many(db, 'SELECT email FROM users WHERE email IN (?, ?)', firstEmail, secondEmail)).toEqual([{ email: winner }]);
	await expect(redeemLoginLink(db, loser)).resolves.toBeNull();
});

test('rejects redemption when the invitation expires after the link is issued', async () => {
	const email = address();
	const token = await memberLink(email, await invitationForTest());
	await run(db, 'UPDATE invitations SET expires_at = ? WHERE token_hash = (SELECT invitation_hash FROM login_links WHERE email = ?)', now() - 1, email);
	await expect(redeemLoginLink(db, token)).resolves.toBeNull();
	await expect(one(db, 'SELECT id FROM users WHERE email = ?', email)).resolves.toBeNull();
});

test('forbids a member from creating an invitation', async () => {
	const memberId = crypto.randomUUID();
	await run(db, 'INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)', memberId, address(), now());
	await expect(createInvitation(db, memberId)).rejects.toThrow('Forbidden');
});
