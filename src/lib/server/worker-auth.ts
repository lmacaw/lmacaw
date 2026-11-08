import { createHash, timingSafeEqual } from 'node:crypto';

export function authorizedWorker(header: string | null, expected: string | undefined): boolean {
	if (!expected || !header?.startsWith('Bearer ')) return false;
	const digest = (value: string) => createHash('sha256').update(value).digest();
	return timingSafeEqual(digest(header.slice(7)), digest(expected));
}
