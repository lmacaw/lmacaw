import { expect, test, vi } from 'vitest';
import { fetchPublicImage, isBlockedHost } from '$lib/server/fetch-image';

const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4);
const imageUrl = 'https://images.example/cat.png';

test.each([
	'localhost', 'foo.localhost', 'foo.LOCAL.', 'foo.internal',
	'0.1.2.3', '10.0.0.1', '100.64.0.1', '100.127.255.255',
	'127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255',
	'192.168.1.1', '224.0.0.1', '240.0.0.1', '255.255.255.255',
	'::', '[::1]', '[0:0:0:0:0:0:0:1]', '[fc00::1]', '[fdff::1]', '[fe80::1]', '[febf::1]',
	'[ff02::1]', '::ffff:127.0.0.1', '[::ffff:a00:1]', '[::ffff:a9fe:a9fe]',
	'2130706433', '0177.0.0.1', '0x7f.1'
])('blocks %s', (host) => {
	expect(isBlockedHost(host)).toBe(true);
});

test.each([
	'example.com', 'localhost.example.com', '1.1.1.1', '100.63.255.255',
	'100.128.0.1', '172.15.255.255', '172.32.0.1', '[2606:4700:4700::1111]'
])('allows %s', (host) => {
	expect(isBlockedHost(host)).toBe(false);
});

test.each([
	'file:///cat.png', 'ftp://images.example/cat.png', 'http://user:secret@images.example/cat.png',
	'http://2130706433/', 'http://0x7f.1/', 'http://[::ffff:127.0.0.1]:8080/'
])('rejects %s before making any request', async (url) => {
	const fetcher = vi.fn();
	await expect(fetchPublicImage(url, fetcher)).rejects.toThrow();
	expect(fetcher).not.toHaveBeenCalled();
});

test('uses manual redirects and rejects a redirect to a private host before fetching it', async () => {
	const fetcher = vi.fn(async (_url: URL | string, _init?: RequestInit) => new Response(null, {
		status: 302, headers: { location: 'http://127.0.0.1/' }
	}));
	await expect(fetchPublicImage(imageUrl, fetcher)).rejects.toThrow('Destination is not public');
	expect(fetcher).toHaveBeenCalledExactlyOnceWith(new URL(imageUrl), {
		redirect: 'manual', signal: expect.any(AbortSignal)
	});
});

test('follows four relative redirects using the current URL and one timeout', async () => {
	const paths = ['/one/a', '/one/b', '/two/c', '/two/d', '/two/cat.png'];
	const locations = ['b', '../two/c', './d', 'cat.png'];
	const fetcher = vi.fn(async (_url: URL | string, _init?: RequestInit) => {
		const location = locations.shift();
		return location ? new Response(null, { status: 302, headers: { location } }) : new Response(png);
	});
	const response = await fetchPublicImage('https://images.example:8080/one/a', fetcher);
	expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
	expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual(paths.map((path) => `https://images.example:8080${path}`));
	const signal = fetcher.mock.calls[0][1]?.signal;
	for (const [, init] of fetcher.mock.calls) expect(init).toEqual({ redirect: 'manual', signal });
});

test('rejects a fifth redirect', async () => {
	const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location: '/again' } }));
	await expect(fetchPublicImage(imageUrl, fetcher)).rejects.toThrow('Too many redirects');
	expect(fetcher).toHaveBeenCalledTimes(5);
});

test('rejects non-200 responses', async () => {
	await expect(fetchPublicImage(imageUrl, async () => new Response(png, { status: 404 })))
		.rejects.toThrow('Image source returned an error');
});

test('rejects HTML regardless of its declared content type', async () => {
	await expect(fetchPublicImage(imageUrl, async () => new Response('<html>not an image</html>', {
		headers: { 'content-type': 'image/png' }
	}))).rejects.toThrow('Invalid image');
});

test('rejects a declared 21 MB body before reading it', async () => {
	const pull = vi.fn();
	const body = new ReadableStream<Uint8Array>({ pull }, { highWaterMark: 0 });
	await expect(fetchPublicImage(imageUrl, async () => new Response(body, {
		headers: { 'content-length': String(21 * 1024 * 1024) }
	}))).rejects.toThrow('Image exceeds the size limit');
	expect(pull).not.toHaveBeenCalled();
});

test('sniffs a split signature and streams all PNG bytes with the sniffed content type', async () => {
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(png.slice(0, 3));
			controller.enqueue(png.slice(3, 8));
			controller.enqueue(png.slice(8));
			controller.close();
		}
	});
	const response = await fetchPublicImage(imageUrl, async () => new Response(body, {
		headers: { 'content-type': 'application/octet-stream' }
	}));
	expect(response.headers.get('content-type')).toBe('image/png');
	expect(response.headers.get('cache-control')).toBe('no-store');
	expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
});

test('streams exactly 20 MB then cancels an undeclared oversized body', async () => {
	const megabyte = new Uint8Array(1024 * 1024);
	megabyte.set(png);
	const cancel = vi.fn();
	const body = new ReadableStream<Uint8Array>({
		pull(controller) { controller.enqueue(megabyte); },
		cancel
	}, { highWaterMark: 0 });
	const response = await fetchPublicImage(imageUrl, async () => new Response(body));
	const reader = response.body!.getReader();

	for (let i = 0; i < 20; i++) expect((await reader.read()).value?.byteLength).toBe(megabyte.byteLength);
	await expect(reader.read()).rejects.toThrow('Image exceeds the size limit');
	expect(cancel).toHaveBeenCalledOnce();
});
