import { afterEach, expect, test, vi } from 'vitest';
import { GET } from '../src/routes/api/v1/fetch/+server';
import { eventFor as routeEvent } from './fixtures';

const imageUrl = 'https://images.example/cat.png';
const imageId = '67e55044-10b1-426f-9247-bb680e5fe0c8';
const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3);

function eventFor(params: Record<string, string>, signedIn = true) {
	const route = '/api/v1/fetch';
	const actor = signedIn ? { id: 'user', email: 'user@example.com', isAdmin: false } : null;
	return routeEvent(route, `${route}?${new URLSearchParams(params)}`, actor);
}

afterEach(() => vi.unstubAllGlobals());

test('requires a session before making requests', async () => {
	const fetcher = vi.fn();
	vi.stubGlobal('fetch', fetcher);
	const response = await GET(eventFor({ url: imageUrl }, false));
	expect(response.status).toBe(401);
	expect(await response.json()).toEqual({ error: 'Unauthorized' });
	expect(fetcher).not.toHaveBeenCalled();
});

const rejectedInputs: Record<string, string>[] = [
	{},
	{ url: '' },
	{ url: imageUrl, openverse: imageId },
	{ openverse: 'invalid' },
	{ url: 'http://127.0.0.1/' }
];

test.each(rejectedInputs)('returns JSON 400 for rejected input %j without fetching', async (params) => {
	const fetcher = vi.fn();
	vi.stubGlobal('fetch', fetcher);
	const response = await GET(eventFor(params));
	expect(response.status).toBe(400);
	expect(await response.json()).toEqual({ error: expect.any(String) });
	expect(fetcher).not.toHaveBeenCalled();
});

test('streams a public image with its sniffed content type and no-store', async () => {
	const fetcher = vi.fn(async () => new Response(png, { headers: { 'content-type': 'text/plain' } }));
	vi.stubGlobal('fetch', fetcher);
	const response = await GET(eventFor({ url: imageUrl }));
	expect(response.status).toBe(200);
	expect(response.headers.get('content-type')).toBe('image/png');
	expect(response.headers.get('cache-control')).toBe('no-store');
	expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
	expect(fetcher).toHaveBeenCalledOnce();
});

test('resolves an Openverse image server-side and fetches the original URL', async () => {
	const fetcher = vi.fn(async (input: string | URL) => {
		if (String(input) === `https://api.openverse.org/v1/images/${imageId}/`) {
			return Response.json({ id: imageId, url: imageUrl, thumbnail: 'https://images.example/thumb.png' });
		}
		if (String(input) === imageUrl) return new Response(png);
		throw new Error('Unexpected URL');
	});
	vi.stubGlobal('fetch', fetcher);
	const response = await GET(eventFor({ openverse: imageId }));
	expect(response.status).toBe(200);
	expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
	expect(fetcher.mock.calls.map(([input]) => String(input))).toEqual([
		`https://api.openverse.org/v1/images/${imageId}/`, imageUrl
	]);
});

test('checks the URL returned by Openverse before requesting it', async () => {
	const fetcher = vi.fn(async () => Response.json({ id: imageId, url: 'http://127.0.0.1/cat.png' }));
	vi.stubGlobal('fetch', fetcher);
	const response = await GET(eventFor({ openverse: imageId }));
	expect(response.status).toBe(400);
	expect(await response.json()).toEqual({ error: 'Unable to import image' });
	expect(fetcher).toHaveBeenCalledOnce();
});

test('maps a rejected upstream response to JSON 400', async () => {
	vi.stubGlobal('fetch', async () => new Response('<html>not an image</html>'));
	const response = await GET(eventFor({ url: imageUrl }));
	expect(response.status).toBe(400);
	expect(await response.json()).toEqual({ error: 'Invalid image' });
});
