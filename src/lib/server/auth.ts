import type { D1Database } from '@cloudflare/workers-types';
import { now, one, run } from './db';
import { readJson } from './request';

export type User = { id: string; email: string; isAdmin: boolean };

const minute = 60_000;
const day = 24 * 60 * minute;
const tokenFormat = /^[A-Za-z0-9_-]{43}$/;
const encoder = new TextEncoder();

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
	db: D1Database, email: string, invitation: string | null, adminEmail: string | undefined
): Promise<string | null> {
	email = normalizeEmail(email);
	const adminAddress = adminEmail?.trim().toLowerCase();
	let invitationHash: string | null = null;

	if (email !== adminAddress && !await one(db, 'SELECT id FROM users WHERE email = ?', email)) {
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

export async function redeemLoginLink(db: D1Database, token: string, adminEmail?: string): Promise<string | null> {
	if (!tokenFormat.test(token)) return null;

	const session = randomToken();
	const [linkHash, sessionHash] = await Promise.all([hashToken(token), hashToken(session)]);
	const timestamp = now();
	const adminAddress = adminEmail?.trim().toLowerCase() ?? null;

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
				) ELSE email = ? OR EXISTS (SELECT 1 FROM users WHERE users.email = login_links.email) END
		`).bind(linkHash, timestamp, timestamp, adminAddress),
		db.prepare(`
			UPDATE invitations
			SET used_at = ?
			WHERE used_at IS NULL AND expires_at > ? AND token_hash = (
				SELECT invitation_hash FROM login_links WHERE token_hash = ? AND used_at = -1
			)
		`).bind(timestamp, timestamp, linkHash),
		db.prepare(`
			INSERT INTO users (id, email, is_admin, created_at)
			SELECT ?, email, CASE WHEN email = ? THEN 1 ELSE 0 END, ?
			FROM login_links WHERE token_hash = ? AND used_at = -1
				AND (invitation_hash IS NULL OR EXISTS (
					SELECT 1 FROM invitations
					WHERE token_hash = login_links.invitation_hash AND used_at = ?
				))
			ON CONFLICT(email) DO NOTHING
		`).bind(crypto.randomUUID(), adminAddress, timestamp, linkHash, timestamp),
		db.prepare(`
			INSERT INTO sessions (token_hash, user_id, expires_at)
			SELECT ?, users.id, ?
			FROM login_links JOIN users ON users.email = login_links.email
			WHERE login_links.token_hash = ? AND login_links.used_at = -1
				AND (login_links.invitation_hash IS NULL OR EXISTS (
					SELECT 1 FROM invitations
					WHERE token_hash = login_links.invitation_hash AND used_at = ?
				))
		`).bind(sessionHash, timestamp + 30 * day, linkHash, timestamp),
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
