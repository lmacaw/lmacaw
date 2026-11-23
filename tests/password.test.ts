import { expect, test } from 'vitest';
import { hashPassword, validPassword, verifyPassword } from '$lib/server/password';

const password = 'a long password 🔑';

test('hashes with a fresh 16-byte salt and a 32-byte PBKDF2-SHA256 digest', async () => {
	const stored = await hashPassword(password);
	expect(stored).toMatch(/^pbkdf2\$100000\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
	expect(await hashPassword(password)).not.toBe(stored);
	await expect(verifyPassword(password, stored)).resolves.toBe(true);
	await expect(verifyPassword('a wrong password', stored)).resolves.toBe(false);

	const fields = stored.split('$');
	fields[3] = (fields[3][0] === 'A' ? 'B' : 'A') + fields[3].slice(1);
	await expect(verifyPassword(password, fields.join('$'))).resolves.toBe(false);
});

test.each([
	'',
	'pbkdf2$100001$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
	'pbkdf2$100000$short$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
	'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAB$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
	'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n'
])('rejects malformed hashes (%j)', async (stored) => {
	await expect(verifyPassword(password, stored)).resolves.toBe(false);
});

test('counts 12 to 1024 characters including supplementary Unicode characters', () => {
	for (const length of [12, 1024]) {
		expect(validPassword('a'.repeat(length))).toBe(true);
		expect(validPassword('🔑'.repeat(length))).toBe(true);
	}
	for (const length of [0, 11, 1025]) {
		expect(validPassword('a'.repeat(length))).toBe(false);
		expect(validPassword('🔑'.repeat(length))).toBe(false);
	}
	expect(validPassword(null)).toBe(false);
});
