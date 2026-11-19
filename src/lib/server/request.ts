import type { D1Database } from '@cloudflare/workers-types';
import { json } from '@sveltejs/kit';
import type { User } from './auth';
import { now, one } from './db';
import { authMode, type Env } from './env';

export async function readJson(request: Request, limit = 4096): Promise<unknown> {
	const reader = request.body?.getReader();
	if (!reader) throw new Error('Missing body');

	const chunks: BlobPart[] = [];
	let size = 0;
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > limit) {
			await reader.cancel();
			throw new Error('Body too large');
		}
		chunks.push(value);
	}
	return JSON.parse(await new Blob(chunks).text());
}

export function trustedOrigin(request: Request, url: URL, origins: string): boolean {
	const origin = request.headers.get('origin');
	return origin === null || origin === url.origin || origins.split(',').some((entry) => {
		const allowed = entry.trim();
		return allowed !== '' && allowed === origin;
	});
}

export function clientAddress(request: Request): string {
	return request.headers.get('CF-Connecting-IP') || 'direct';
}

export async function allowAttempt(db: D1Database, key: string, limit = 10, windowMs = 60_000): Promise<boolean> {
	const timestamp = now();
	const cutoff = timestamp - windowMs;
	const row = await one<{ attempts: number }>(db, `
		INSERT INTO rate_limits (key, attempts, window_start) VALUES (?, 1, ?)
		ON CONFLICT(key) DO UPDATE SET
			attempts = CASE WHEN window_start < ? THEN 1 ELSE attempts + 1 END,
			window_start = CASE WHEN window_start < ? THEN excluded.window_start ELSE window_start END
		RETURNING attempts
	`, key, timestamp, cutoff, cutoff);
	return row !== null && row.attempts <= limit;
}

/**
 * Who may call a route, named by the password-mode role and mapped onto the current mode:
 * - 'anon':   public mode, anyone; password mode, a signed-in member.
 * - 'member': public mode, an admin (there are no members); password mode, a signed-in member.
 * - 'admin':  an admin in both modes (public: a valid Access token on ADMIN_HOST, set by the hook).
 */
export type Role = 'anon' | 'member' | 'admin';

type RoleEvent = { locals: App.Locals; platform?: App.Platform };

/**
 * Returns the caller (null for an anonymous caller where that is allowed), or a JSON error Response to
 * return as is. A missing caller gets 401 in password mode, where signing in helps, and 403 in public
 * mode, where it cannot.
 */
export function requireRole(event: RoleEvent, role: Role, env: Pick<Env, 'AUTH_MODE'>): User | null | Response {
	const user = event.locals.user;
	const mode = authMode(env);
	if (mode === 'public' && role === 'anon') return user;
	if (!user) return mode === 'public'
		? json({ error: 'Forbidden' }, { status: 403 })
		: json({ error: 'Unauthorized' }, { status: 401 });
	if ((role === 'admin' || mode === 'public') && !user.isAdmin) return json({ error: 'Forbidden' }, { status: 403 });
	return user;
}
