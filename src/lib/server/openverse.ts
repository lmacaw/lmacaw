export type OpenverseImage = { id: string; title: string; imageUrl: string; thumbnail: string; source: string; creator: string; creatorUrl: string; license: string; licenseUrl: string; attribution: string };
type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

function mapImage(input: Record<string, unknown>): OpenverseImage {
	const field = (key: string) => typeof input[key] === 'string' ? input[key] as string : '';
	return { id: field('id'), title: field('title'), imageUrl: field('url'), thumbnail: field('thumbnail'), source: field('foreign_landing_url'), creator: field('creator'), creatorUrl: field('creator_url'), license: field('license'), licenseUrl: field('license_url'), attribution: field('attribution') };
}

export async function searchOpenverse(query: string, page = 1, fetcher: Fetcher = fetch): Promise<OpenverseImage[]> {
	const url = new URL('https://api.openverse.org/v1/images/');
	url.search = new URLSearchParams({ q: query, page: String(page), page_size: '20', mature: 'false' }).toString();
	const response = await fetcher(url, { signal: AbortSignal.timeout(10_000) });
	if (!response.ok) throw new Error('Image search unavailable');
	const body = await response.json() as { results?: Record<string, unknown>[] };
	return (body.results ?? []).map(mapImage).filter((item) => item.id && item.imageUrl);
}

export async function getOpenverseImage(id: string, fetcher: Fetcher = fetch): Promise<OpenverseImage> {
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('Invalid image');
	const response = await fetcher(`https://api.openverse.org/v1/images/${id}/`, { signal: AbortSignal.timeout(10_000) });
	if (!response.ok) throw new Error('Image unavailable');
	return mapImage(await response.json() as Record<string, unknown>);
}
