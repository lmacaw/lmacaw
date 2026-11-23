import { afterEach, expect, test, vi } from 'vitest';
import { GET } from '../src/routes/api/v1/discover/+server';
import { createTestItem, eventFor as routeEvent, user } from './fixtures';

function eventFor(params: Record<string, string> = {}, signedIn = true) {
	const route = '/api/v1/discover';
	const actor = signedIn ? { id: 'user', email: 'user@example.com', isAdmin: false } : null;
	return routeEvent(route, `${route}?${new URLSearchParams(params)}`, actor);
}

afterEach(() => vi.unstubAllGlobals());

test('discovery requires a signed-in user and a search term', async () => {
	const fetcher = vi.fn();
	vi.stubGlobal('fetch', fetcher);
	const unauthorized = await GET(eventFor({ q: 'cat' }, false));
	expect(unauthorized.status).toBe(401);
	expect(await unauthorized.json()).toEqual({ error: 'Unauthorized' });
	for (const query of [undefined, '  ', 'a'.repeat(201)]) {
		const response = await GET(eventFor(query === undefined ? {} : { q: query }));
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'Enter a search term' });
	}
	expect(fetcher).not.toHaveBeenCalled();
});

test.each([
	['2', '2'], ['100', '100'], ['0', '1'], ['1.5', '1'], ['101', '1'], ['bad', '1']
])('uses the expected search page for %s', async (requested, expected) => {
	const fetcher = vi.fn(async (_url: URL | string) => Response.json({
		results: [{ id: 'cat-id', title: 'Cat', url: 'https://images.example/cat.png' }]
	}));
	vi.stubGlobal('fetch', fetcher);
	const response = await GET(eventFor({ q: ' cat ', page: requested }));
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({
		items: [expect.objectContaining({ id: 'cat-id', imageUrl: 'https://images.example/cat.png' })]
	});
	const upstream = new URL(fetcher.mock.calls[0][0]);
	expect(upstream.origin).toBe('https://api.openverse.org');
	expect(upstream.searchParams.get('q')).toBe('cat');
	expect(upstream.searchParams.get('page')).toBe(expected);
});

test('maps an upstream search failure to 502', async () => {
	vi.stubGlobal('fetch', async () => new Response(null, { status: 503 }));
	const response = await GET(eventFor({ q: 'cat' }));
	expect(response.status).toBe(502);
	expect(await response.json()).toEqual({ error: 'Search unavailable' });
});

test('marks results the caller already saved', async () => {
	const [owner, other] = [await user(), await user()];
	await createTestItem(owner, { source: { source: 'https://images.example/saved' } });
	await createTestItem(other, { source: { source: 'https://images.example/theirs' } });
	vi.stubGlobal('fetch', async () => Response.json({ results: [
		{ id: 'saved-id', url: 'https://images.example/a.png', foreign_landing_url: 'https://images.example/saved' },
		{ id: 'theirs-id', url: 'https://images.example/b.png', foreign_landing_url: 'https://images.example/theirs' },
		{ id: 'new-id', url: 'https://images.example/c.png', foreign_landing_url: '' }
	] }));
	const route = '/api/v1/discover';
	const response = await GET(routeEvent(route, `${route}?q=cat`, owner));
	expect((await response.json()).items.map((item: { id: string; saved: boolean }) => [item.id, item.saved]))
		.toEqual([['saved-id', true], ['theirs-id', false], ['new-id', false]]);
});
