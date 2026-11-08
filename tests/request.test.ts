import { expect, test } from 'bun:test';
import { readJson } from '../src/lib/server/request';

test('rejects JSON bodies larger than the limit even without content-length', async () => {
	const request = new Request('https://example.test', { method: 'POST', body: JSON.stringify({ value: 'x'.repeat(5000) }) });
	await expect(readJson(request)).rejects.toThrow('Body too large');
});

test('parses JSON within the limit', async () => {
	const request = new Request('https://example.test', { method: 'POST', body: JSON.stringify({ value: 'ok' }) });
	expect(await readJson(request)).toEqual({ value: 'ok' });
});
