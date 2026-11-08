import { expect, test } from 'bun:test';
import { searchOpenverse } from '../src/lib/server/openverse';

test('preserves source, creator, license and attribution from search', async () => {
	const fetcher = async () => new Response(JSON.stringify({ results: [{ id: 'abc', title: 'Cat', url: 'https://example.org/cat.png', foreign_landing_url: 'https://example.org/cat', creator: 'A', creator_url: 'https://example.org/a', license: 'by', license_url: 'https://example.org/license', attribution: 'Cat by A', thumbnail: 'https://example.org/thumb.png' }] }), { status: 200 });
	const result = await searchOpenverse('cat', 1, fetcher);
	expect(result[0]).toMatchObject({ id: 'abc', title: 'Cat', source: 'https://example.org/cat', creator: 'A', license: 'by', licenseUrl: 'https://example.org/license', attribution: 'Cat by A' });
});

test('requests no more than the anonymous page size limit', async () => {
	let requested = '';
	const fetcher = async (url: string | URL) => { requested = String(url); return new Response(JSON.stringify({ results: [] })); };
	await searchOpenverse('cat', 1, fetcher);
	// Openverse rejects anonymous requests above 20 results per page with HTTP 401 (checked 2026-11-08).
	expect(Number(new URL(requested).searchParams.get('page_size'))).toBeLessThanOrEqual(20);
});
