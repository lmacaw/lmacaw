import { afterAll, beforeAll, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { bootstrapAdmin, createInvitation, redeemInvitation, login, authenticate, logout } from '../src/lib/server/auth';

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.endsWith('_test')) {
	throw new Error('TEST_DATABASE_URL must point to a database whose name ends in _test');
}
const sql = new SQL(testUrl);

beforeAll(async () => {
	await sql`TRUNCATE invitations, sessions, users RESTART IDENTITY CASCADE`;
});
afterAll(async () => { await sql.close(); });

test('admin bootstrap, invitations, and sessions enforce ownership and expiry', async () => {
	const admin = await bootstrapAdmin(sql, 'Admin@example.com', 'a long admin password');
	await expect(bootstrapAdmin(sql, 'second@example.com', 'another long password')).rejects.toThrow();
	expect(await login(sql, 'admin@example.com', 'wrong password')).toBeNull();
	const session = await login(sql, 'admin@example.com', 'a long admin password');
	expect(session).not.toBeNull();
	expect((await authenticate(sql, session!))?.id).toBe(admin.id);
	const invitation = await createInvitation(sql, admin.id);
	const member = await redeemInvitation(sql, invitation, 'member@example.com', 'a long member password');
	await expect(redeemInvitation(sql, invitation, 'other@example.com', 'another long password')).rejects.toThrow();
	await expect(createInvitation(sql, member.id)).rejects.toThrow();
	const expired = await createInvitation(sql, admin.id);
	await sql`UPDATE invitations SET expires_at = now() - interval '1 second' WHERE used_at IS NULL`;
	await expect(redeemInvitation(sql, expired, 'expired@example.com', 'a long member password')).rejects.toThrow();
	await logout(sql, session!);
	expect(await authenticate(sql, session!)).toBeNull();
});
