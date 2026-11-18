import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { SQL } from 'bun';

export type User = { id: string; email: string; isAdmin: boolean };
const dummyPasswordHash = '$argon2id$v=19$m=65536,t=2,p=1$2R61DyXmSHwsgPW6zL3/FLFDJK1j/LeSCV5RAxTXuz0$tjFWgbddw0e121v23ThccYfsx32nRtCS8xo9MC/PFhE';
const token = () => randomBytes(32).toString('base64url');
const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');
const emailAddress = (value: string) => {
	const email = value.trim().toLowerCase();
	if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid email');
	return email;
};
const hashPassword = async (password: string) => {
	if (password.length < 12 || password.length > 1024) throw new Error('Password must be at least 12 characters');
	return Bun.password.hash(password, { algorithm: 'argon2id' });
};

export async function bootstrapAdmin(sql: SQL, address: string, password: string): Promise<User> {
	const email = emailAddress(address);
	const passwordHash = await hashPassword(password);
	return sql.begin(async (tx) => {
		await tx`SELECT pg_advisory_xact_lock(80725140)`;
		const existing = await tx`SELECT id FROM users LIMIT 1`;
		if (existing.length) throw new Error('Already initialized');
		const id = randomUUID();
		await tx`INSERT INTO users (id, email, password_hash, is_admin) VALUES (${id}, ${email}, ${passwordHash}, true)`;
		return { id, email, isAdmin: true };
	});
}

export async function createInvitation(sql: SQL, userId: string): Promise<string> {
	const value = token();
	const rows = await sql`INSERT INTO invitations (token_hash, created_by, expires_at)
		SELECT ${hashToken(value)}, id, now() + interval '7 days' FROM users WHERE id = ${userId} AND is_admin = true RETURNING token_hash`;
	if (!rows.length) throw new Error('Forbidden');
	return value;
}

export async function redeemInvitation(sql: SQL, value: string, address: string, password: string): Promise<User> {
	const email = emailAddress(address);
	const passwordHash = await hashPassword(password);
	return sql.begin(async (tx) => {
		const claimed = await tx`UPDATE invitations SET used_at = now() WHERE token_hash = ${hashToken(value)} AND used_at IS NULL AND expires_at > now() RETURNING token_hash`;
		if (!claimed.length) throw new Error('Invalid or expired invitation');
		const id = randomUUID();
		await tx`INSERT INTO users (id, email, password_hash) VALUES (${id}, ${email}, ${passwordHash})`;
		return { id, email, isAdmin: false };
	});
}

export async function login(sql: SQL, address: string, password: string): Promise<string | null> {
	let email: string;
	try { email = emailAddress(address); } catch { return null; }
	const rows = await sql`SELECT id, password_hash FROM users WHERE email = ${email}`;
	const matches = await Bun.password.verify(password, rows[0]?.password_hash ?? dummyPasswordHash);
	if (!rows.length || !matches) return null;
	const value = token();
	await sql`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (${hashToken(value)}, ${rows[0].id}, now() + interval '30 days')`;
	return value;
}

export async function authenticate(sql: SQL, value: string): Promise<User | null> {
	const rows = await sql`SELECT u.id, u.email, u.is_admin FROM users u JOIN sessions s ON s.user_id = u.id WHERE s.token_hash = ${hashToken(value)} AND s.expires_at > now()`;
	return rows.length ? { id: rows[0].id, email: rows[0].email, isAdmin: rows[0].is_admin } : null;
}

export async function logout(sql: SQL, value: string): Promise<void> {
	await sql`DELETE FROM sessions WHERE token_hash = ${hashToken(value)}`;
}

// Sets a new password and signs the account out everywhere. Run by the operator from the server
// (scripts/reset-password.ts); there is no mail delivery for self-service resets.
export async function resetPassword(sql: SQL, address: string, password: string): Promise<boolean> {
	const email = emailAddress(address);
	const passwordHash = await hashPassword(password);
	const rows = await sql`WITH account AS (UPDATE users SET password_hash = ${passwordHash} WHERE email = ${email} RETURNING id),
		ended AS (DELETE FROM sessions WHERE user_id IN (SELECT id FROM account))
		SELECT id FROM account`;
	return rows.length > 0;
}
