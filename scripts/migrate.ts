import { readdir } from 'node:fs/promises';
import { SQL } from 'bun';
import { databaseUrl } from '../src/lib/server/config';

const sql = new SQL(databaseUrl(process.env));
try {
	await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
	const files = (await readdir('migrations')).filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
	for (const name of files) {
		await sql.begin(async (tx) => {
			await tx`SELECT pg_advisory_xact_lock(80725139)`;
			const rows = await tx`SELECT name FROM schema_migrations WHERE name = ${name}`;
			if (rows.length) return;
			await tx.unsafe(await Bun.file(`migrations/${name}`).text());
			await tx`INSERT INTO schema_migrations (name) VALUES (${name})`;
			console.log(`Applied ${name}`);
		});
	}
} finally {
	await sql.close();
}
