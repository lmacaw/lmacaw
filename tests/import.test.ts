import { expect, test } from 'bun:test';
import { isPublicAddress, fetchPublicImage } from '../src/lib/server/import';
import { createServer, request } from 'node:http';

test('rejects local, private, link-local and mapped private addresses', () => {
	for (const address of ['127.0.0.1', '10.0.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1']) expect(isPublicAddress(address)).toBe(false);
	expect(isPublicAddress('1.1.1.1')).toBe(true);
	expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
});

test('rejects non-web URLs and direct private addresses before connecting', async () => {
	for (const url of ['file:///etc/passwd', 'http://127.0.0.1/secret', 'http://[::1]/']) await expect(fetchPublicImage(url)).rejects.toThrow();
});

test('HTTP client honors a pinned lookup address', async () => {
	const server = createServer((_req, res) => res.end('ok'));
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	try {
		const address = server.address();
		if (!address || typeof address === 'string') throw new Error('No test port');
		let called = false;
		const body = await new Promise<string>((resolve, reject) => {
			const req = request(`http://invalid.invalid:${address.port}/`, { lookup: (_host, options, cb) => { called = true; if (typeof options === 'object' && options.all) (cb as unknown as (error: null, addresses: { address: string; family: number }[]) => void)(null, [{ address: '127.0.0.1', family: 4 }]); else cb(null, '127.0.0.1', 4); } }, (res) => {
				let value = ''; res.on('data', (chunk) => { value += chunk; }); res.on('end', () => resolve(value));
			});
			req.on('error', reject); req.end();
		});
		expect(called).toBe(true); expect(body).toBe('ok');
	} finally { server.close(); }
});
