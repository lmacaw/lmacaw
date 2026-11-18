import { createHash } from 'node:crypto';
import type { SQL } from 'bun';

export async function readJson(request: Request, limit = 4096): Promise<unknown> {
	const reader = request.body?.getReader();
	if (!reader) throw new Error('Missing body');
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > limit) { await reader.cancel(); throw new Error('Body too large'); }
		chunks.push(value);
	}
	return JSON.parse(await new Blob(chunks as BlobPart[]).text());
}

export async function allowAttempt(sql: SQL, purpose: string, address: string): Promise<boolean> {
	const client = createHash('sha256').update(`${purpose}:${address}`).digest('hex');
	const rows = await sql`INSERT INTO login_attempts (client_hash, attempts, window_start) VALUES (${client}, 1, now())
		ON CONFLICT (client_hash) DO UPDATE SET
		attempts = CASE WHEN login_attempts.window_start < now() - interval '1 minute' THEN 1 ELSE login_attempts.attempts + 1 END,
		window_start = CASE WHEN login_attempts.window_start < now() - interval '1 minute' THEN now() ELSE login_attempts.window_start END
		RETURNING attempts`;
	return rows[0].attempts <= 10;
}

// A browser request is trusted when it comes from one of the ORIGIN addresses (scripts/serve.ts
// keeps the full comma-separated list in LMACAW_ORIGINS) or from url.origin itself.
// Requests without an Origin header (same-origin GETs, the worker, scripts) pass.
export function trustedOrigin(request: Request, url: URL, origins = process.env.LMACAW_ORIGINS ?? ''): boolean {
	const origin = request.headers.get('origin');
	if (!origin || origin === url.origin) return true;
	return origins.split(',').includes(origin);
}
