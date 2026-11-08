import { expect, test } from 'bun:test';
import { health } from '../src/lib/server/health';

test('reports healthy when the database responds', async () => {
	expect(await health(async () => true)).toEqual({ ok: true });
});

test('reports unavailable when the database fails', async () => {
	expect(await health(async () => { throw new Error('offline'); })).toEqual({ ok: false });
});
