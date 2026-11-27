import { describe, expect, it } from 'vitest';
import { eachLimit } from '../src/lib/upload';

describe('eachLimit', () => {
	it('runs every item with at most `limit` in flight', async () => {
		let running = 0, peak = 0;
		const seen: number[] = [];
		await eachLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
			peak = Math.max(peak, ++running);
			await new Promise((resolve) => setTimeout(resolve, 5));
			seen.push(n); running--;
		});
		expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
		expect(peak).toBe(3);
	});
	it('handles an empty list', async () => {
		await eachLimit([], 3, async () => { throw new Error('unreachable'); });
	});
});
