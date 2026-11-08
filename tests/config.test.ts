import { expect, test } from 'bun:test';
import { databaseUrl } from '../src/lib/server/config';

test('requires a PostgreSQL database URL', () => {
	expect(() => databaseUrl({})).toThrow('DATABASE_URL');
	expect(() => databaseUrl({ DATABASE_URL: 'https://example.com' })).toThrow('DATABASE_URL');
});

test('accepts a PostgreSQL database URL', () => {
	expect(databaseUrl({ DATABASE_URL: 'postgresql://localhost/lmacaw' })).toBe('postgresql://localhost/lmacaw');
});
