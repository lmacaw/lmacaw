import { expect, test } from 'bun:test';
import { GET } from '../src/routes/api/v1/discover/+server';
import { POST } from '../src/routes/api/v1/discover/save/+server';

test('discovery requires a logged-in user and a search term', async () => {
	expect((await GET({ locals: { user: null }, url: new URL('https://example.test/api/v1/discover?q=cat') } as never)).status).toBe(401);
	expect((await GET({ locals: { user: { id: 'x' } }, url: new URL('https://example.test/api/v1/discover') } as never)).status).toBe(400);
});

test('saving rejects malformed Openverse identifiers', async () => {
	const request = new Request('https://example.test/api/v1/discover/save', { method: 'POST', headers: { origin: 'https://example.test' }, body: JSON.stringify({ id: 'invalid' }) });
	const response = await POST({ request, url: new URL(request.url), locals: { user: { id: 'x' } } } as never);
	expect(response.status).toBe(400);
});
