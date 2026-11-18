import type { D1Database, D1Result } from '@cloudflare/workers-types';
export function one<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T | null> {
	return db.prepare(sql).bind(...params).first<T>();
}

export async function many<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
	const { results } = await db.prepare(sql).bind(...params).all<T>();
	return results;
}

export function run(db: D1Database, sql: string, ...params: unknown[]): Promise<D1Result> {
	return db.prepare(sql).bind(...params).run();
}

export function now(): number {
	return Date.now();
}
