import { expect, test } from 'bun:test';
import { SQL } from 'bun';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL must point to a test database');

test('app connections end transactions left idle', async () => {
	process.env.DATABASE_URL = url;
	const { db } = await import('../src/lib/server/db');
	const rows = await db()`SHOW idle_in_transaction_session_timeout`;
	expect(rows[0].idle_in_transaction_session_timeout).toBe('1min');
});

// Bun 1.3.11 ran these on a connection another caller was using; Bun 1.4.4 fixed both (oven-sh/bun#45304).
test('a transaction query awaited after commit never runs on another caller\'s connection', async () => {
	const sql = new SQL(url, { max: 1 });
	try {
		let late: Promise<unknown> | undefined;
		await sql.begin(async (tx) => { late = tx`SELECT 1`; await tx`SELECT 1`; });
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const other = sql.begin(async (tx) => { await tx`SELECT 1`; await gate; });
		await Bun.sleep(20);
		await expect(late!).rejects.toThrow();
		release();
		await other;
	} finally { await sql.close(); }
});

test('a connection released inside an open transaction is not reused', async () => {
	const sql = new SQL(url, { max: 1 });
	try {
		const reserved = await sql.reserve();
		await reserved`BEGIN`;
		await reserved`SELECT set_config('lmacaw.open_tx', 'yes', true)`;
		reserved.release();
		const [row] = await sql`SELECT coalesce(current_setting('lmacaw.open_tx', true), '') AS open_tx`;
		expect(row.open_tx).toBe('');
	} finally { await sql.close(); }
});
