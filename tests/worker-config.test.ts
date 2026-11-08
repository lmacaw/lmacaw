import { expect, test } from 'bun:test';
import { workerConfig } from '../worker/config';

test('requires HTTPS for remote servers to protect worker credentials', () => {
	expect(() => workerConfig({ LMACAW_URL: 'http://example.com', AI_WORKER_TOKEN: 'secret' })).toThrow();
	expect(workerConfig({ LMACAW_URL: 'http://127.0.0.1:3000', AI_WORKER_TOKEN: 'secret' }).serverUrl).toBe('http://127.0.0.1:3000');
	expect(workerConfig({ LMACAW_URL: 'https://example.com', AI_WORKER_TOKEN: 'secret' }).serverUrl).toBe('https://example.com');
});
