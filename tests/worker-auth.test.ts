import { expect, test } from 'bun:test';
import { authorizedWorker } from '../src/lib/server/worker-auth';

test('worker requests require a matching configured bearer credential', () => {
	expect(authorizedWorker('Bearer secret', undefined)).toBe(false);
	expect(authorizedWorker('Bearer wrong', 'secret')).toBe(false);
	expect(authorizedWorker('Basic secret', 'secret')).toBe(false);
	expect(authorizedWorker('Bearer secret', 'secret')).toBe(true);
});
