export function databaseUrl(env: Record<string, string | undefined>): string {
	const value = env.DATABASE_URL;
	if (!value) throw new Error('DATABASE_URL is required');
	let url: URL;
	try { url = new URL(value); } catch { throw new Error('DATABASE_URL must be a PostgreSQL URL'); }
	if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
		throw new Error('DATABASE_URL must be a PostgreSQL URL');
	}
	return value;
}
