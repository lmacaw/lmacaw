import type { D1Database } from '@cloudflare/workers-types';
import type { Cookies } from '@sveltejs/kit';
import { now, one, run } from './db';
import { hashPassword, validPassword, verifyPassword } from './password';
import { allowAttempt, clientAddress, readJson } from './request';

export type User = { id: string; email: string; isAdmin: boolean };

const minute = 60_000;
const day = 24 * 60 * minute;
const sessionLifetime = 30 * day;
const tokenFormat = /^[A-Za-z0-9_-]{43}$/;
const encoder = new TextEncoder();
const dummyPasswordHash = 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export const sessionCookie = 'lmacaw_session';

function randomToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function hashToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function normalizeEmail(value: string): string {
	const email = value.trim().toLowerCase();
	if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw new Error('Invalid email');
	}
	return email;
}

export function setSessionCookie(cookies: Cookies, url: URL, token: string): void {
	cookies.set(sessionCookie, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		maxAge: sessionLifetime / 1000
	});
}

export function readCredentialBody(request: Request): Promise<unknown> {
	// JSON escapes can take twelve bytes per supplementary Unicode character.
	return readJson(request, 16 * 1024);
}

export function passwordCredentials(body: unknown): { email: string; password: string } {
	if (!body || typeof body !== 'object' || !('email' in body) || typeof body.email !== 'string'
		|| !('password' in body) || !validPassword(body.password)) {
		throw new Error('Invalid request');
	}
	return { email: normalizeEmail(body.email), password: body.password };
}

export async function allowSignInAttempt(db: D1Database, request: Request, email: string): Promise<boolean> {
	const [ipAllowed, emailAllowed] = await Promise.all([
		allowAttempt(db, `signin:ip:${clientAddress(request)}`),
		allowAttempt(db, `signin:email:${email}`)
	]);
	return ipAllowed && emailAllowed;
}

function insertSession(db: D1Database, tokenHash: string, userId: string, timestamp: number) {
	return db.prepare(`
		INSERT INTO sessions (token_hash, user_id, expires_at)
		SELECT ?, id, ? FROM users WHERE id = ?
	`).bind(tokenHash, timestamp + sessionLifetime, userId);
}

export async function signInWithPassword(db: D1Database, email: string, password: string): Promise<string | null> {
	const user = await one<{ id: string; password_hash: string | null }>(db,
		'SELECT id, password_hash FROM users WHERE email = ?', normalizeEmail(email));
	const verified = await verifyPassword(password, user?.password_hash ?? dummyPasswordHash);
	if (!verified || !user?.password_hash) return null;

	const session = randomToken();
	const result = await insertSession(db, await hashToken(session), user.id, now()).run();
	return result.meta.changes === 1 ? session : null;
}

export async function setupFirstAdmin(
	db: D1Database, email: string, password: string, adminEmail: string | undefined
): Promise<string> {
	email = normalizeEmail(email);
	if (email !== adminEmail?.trim().toLowerCase()) throw new Error('Forbidden');

	const id = crypto.randomUUID();
	const session = randomToken();
	const [passwordHash, sessionHash] = await Promise.all([hashPassword(password), hashToken(session)]);
	const timestamp = now();
	const [inserted] = await db.batch([
		db.prepare(`
			INSERT INTO users (id, email, is_admin, created_at, password_hash)
			SELECT ?, ?, 1, ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)
		`).bind(id, email, timestamp, passwordHash),
		insertSession(db, sessionHash, id, timestamp)
	]);
	if (inserted.meta.changes !== 1) throw new Error('Already set up');
	return session;
}

export async function registerWithInvitation(
	db: D1Database, invitation: string, email: string, password: string
): Promise<string> {
	if (!tokenFormat.test(invitation)) throw new Error('Invalid invitation');
	email = normalizeEmail(email);

	const id = crypto.randomUUID();
	const session = randomToken();
	const [passwordHash, invitationHash, sessionHash] = await Promise.all([
		hashPassword(password), hashToken(invitation), hashToken(session)
	]);
	const timestamp = now();

	// Only the batch that inserts the new user can consume the invitation or create its session.
	const [inserted, , , available] = await db.batch([
		db.prepare(`
			INSERT INTO users (id, email, created_at, password_hash)
			SELECT ?, ?, ?, ? FROM invitations
			WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
			ON CONFLICT(email) DO NOTHING
		`).bind(id, email, timestamp, passwordHash, invitationHash, timestamp),
		db.prepare(`
			UPDATE invitations SET used_at = ?
			WHERE token_hash = ? AND EXISTS (SELECT 1 FROM users WHERE id = ?)
		`).bind(timestamp, invitationHash, id),
		insertSession(db, sessionHash, id, timestamp),
		db.prepare(`
			SELECT 1 FROM invitations WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
		`).bind(invitationHash, timestamp)
	]);
	if (inserted.meta.changes === 1) return session;
	throw new Error(available.results.length ? 'Email taken' : 'Invalid invitation');
}

export async function upsertAccessAdmin(db: D1Database, email: string): Promise<User> {
	const row = await one<{ id: string; email: string }>(db, `
		INSERT INTO users (id, email, is_admin, created_at)
		VALUES (?, ?, 1, ?)
		ON CONFLICT(email) DO UPDATE SET is_admin = 1
		RETURNING id, email
	`, crypto.randomUUID(), email.trim().toLowerCase(), now());
	if (!row) throw new Error('Unable to upsert Access administrator');
	return { ...row, isAdmin: true };
}

export async function readLoginLinkRequest(request: Request): Promise<{ email: string; invitation: string | null }> {
	const body = await readJson(request);
	if (!body || typeof body !== 'object' || !('email' in body) || typeof body.email !== 'string') {
		throw new Error('Invalid request');
	}
	const invitation = 'invitation' in body ? body.invitation : undefined;
	if (invitation !== undefined && typeof invitation !== 'string') {
		throw new Error('Invalid request');
	}
	return { email: normalizeEmail(body.email), invitation: invitation ?? null };
}

export async function createLoginLink(
	db: D1Database, email: string, invitation: string | null, _adminEmail?: string
): Promise<string | null> {
	email = normalizeEmail(email);
	let invitationHash: string | null = null;

	if (!await one(db, 'SELECT id FROM users WHERE email = ?', email)) {
		if (!invitation || !tokenFormat.test(invitation)) return null;
		invitationHash = await hashToken(invitation);
		const available = await one(db, `
			SELECT 1 FROM invitations WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
		`, invitationHash, now());
		if (!available) return null;
	}

	const token = randomToken();
	await run(db, 'INSERT INTO login_links (token_hash, email, invitation_hash, expires_at) VALUES (?, ?, ?, ?)',
		await hashToken(token), email, invitationHash, now() + 15 * minute);
	return token;
}

export async function redeemLoginLink(db: D1Database, token: string, _adminEmail?: string): Promise<string | null> {
	if (!tokenFormat.test(token)) return null;

	const session = randomToken();
	const [linkHash, sessionHash] = await Promise.all([hashToken(token), hashToken(session)]);
	const timestamp = now();
	// The batch commits atomically. Use -1 until it finishes so a rejected claim
	// cannot match a previous redemption that committed in the same millisecond.
	const [claim, , , sessionInsert] = await db.batch([
		db.prepare(`
			UPDATE login_links
			SET used_at = -1
			WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
				AND CASE WHEN invitation_hash IS NOT NULL THEN EXISTS (
					SELECT 1 FROM invitations
					WHERE token_hash = login_links.invitation_hash AND used_at IS NULL AND expires_at > ?
				) ELSE EXISTS (SELECT 1 FROM users WHERE users.email = login_links.email) END
		`).bind(linkHash, timestamp, timestamp),
		db.prepare(`
			UPDATE invitations
			SET used_at = ?
			WHERE used_at IS NULL AND expires_at > ? AND token_hash = (
				SELECT invitation_hash FROM login_links WHERE token_hash = ? AND used_at = -1
			)
		`).bind(timestamp, timestamp, linkHash),
		db.prepare(`
			INSERT INTO users (id, email, created_at)
			SELECT ?, email, ?
			FROM login_links WHERE token_hash = ? AND used_at = -1
				AND EXISTS (
					SELECT 1 FROM invitations
					WHERE token_hash = login_links.invitation_hash AND used_at = ?
				)
			ON CONFLICT(email) DO NOTHING
		`).bind(crypto.randomUUID(), timestamp, linkHash, timestamp),
		db.prepare(`
			INSERT INTO sessions (token_hash, user_id, expires_at)
			SELECT ?, users.id, ?
			FROM login_links JOIN users ON users.email = login_links.email
			WHERE login_links.token_hash = ? AND login_links.used_at = -1
				AND (login_links.invitation_hash IS NULL OR EXISTS (
					SELECT 1 FROM invitations
					WHERE token_hash = login_links.invitation_hash AND used_at = ?
				))
		`).bind(sessionHash, timestamp + sessionLifetime, linkHash, timestamp),
		db.prepare('UPDATE login_links SET used_at = ? WHERE token_hash = ? AND used_at = -1')
			.bind(timestamp, linkHash)
	]);

	return claim.meta.changes === 1 && sessionInsert.meta.changes === 1 ? session : null;
}

export async function authenticate(db: D1Database, token: string): Promise<User | null> {
	if (!tokenFormat.test(token)) return null;

	const row = await one<{ id: string; email: string; is_admin: number }>(db, `
		SELECT users.id, users.email, users.is_admin
		FROM users JOIN sessions ON sessions.user_id = users.id
		WHERE sessions.token_hash = ? AND sessions.expires_at > ?
	`, await hashToken(token), now());
	return row && { id: row.id, email: row.email, isAdmin: row.is_admin === 1 };
}

export async function logout(db: D1Database, token: string): Promise<void> {
	if (!tokenFormat.test(token)) return;
	await run(db, 'DELETE FROM sessions WHERE token_hash = ?', await hashToken(token));
}

export async function createInvitation(db: D1Database, adminId: string): Promise<string> {
	const token = randomToken();
	const invitation = await one(db, `
		INSERT INTO invitations (token_hash, created_by, expires_at)
		SELECT ?, id, ? FROM users WHERE id = ? AND is_admin = 1
		RETURNING token_hash
	`, await hashToken(token), now() + 7 * day, adminId);
	if (!invitation) throw new Error('Forbidden');
	return token;
}
