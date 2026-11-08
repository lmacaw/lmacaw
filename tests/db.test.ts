import { expect, test } from 'bun:test';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL must point to a test database');

test('app connections end transactions left idle', async () => {
	process.env.DATABASE_URL = url;
	const { db } = await import('../src/lib/server/db');
	const rows = await db()`SHOW idle_in_transaction_session_timeout`;
	expect(rows[0].idle_in_transaction_session_timeout).toBe('1min');
});
