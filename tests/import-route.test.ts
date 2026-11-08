import { expect, test } from 'bun:test';
import { POST } from '../src/routes/api/v1/import/+server';

test('rejects internal URL imports', async () => {
	const request = new Request('https://example.test/api/v1/import', { method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json' }, body: JSON.stringify({ url: 'http://127.0.0.1/secret' }) });
	const response = await POST({ request, url: new URL(request.url), locals: { user: { id: '7b48e63d-e598-4d7b-a14f-afc4a70bbabc' } } } as never);
	expect(response.status).toBe(400);
});
