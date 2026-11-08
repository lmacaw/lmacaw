import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';

export function isPublicAddress(value: string): boolean {
	try { return ipaddr.process(value).range() === 'unicast'; } catch { return false; }
}

export async function fetchPublicImage(input: string): Promise<Uint8Array> {
	const signal = AbortSignal.timeout(15_000);
	let current = new URL(input);
	for (let redirects = 0; redirects <= 4; redirects++) {
		if (!['http:', 'https:'].includes(current.protocol) || current.username || current.password) throw new Error('Invalid URL');
		const hostname = current.hostname.replace(/^\[|\]$/g, '');
		const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname, { all: true, verbatim: true });
		if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new Error('Destination is not public');
		const selected = addresses[0];
		const result = await new Promise<{ location?: string; body?: Uint8Array }>((resolve, reject) => {
			const send = current.protocol === 'https:' ? httpsRequest : httpRequest;
			const req = send(current, { signal, lookup: (_host, options, callback) => {
				if (typeof options === 'object' && options.all) (callback as unknown as (error: null, addresses: { address: string; family: number }[]) => void)(null, [selected]);
				else callback(null, selected.address, selected.family);
			} }, (response) => {
				if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
					response.resume(); resolve({ location: response.headers.location }); return;
				}
				if (response.statusCode !== 200) { response.resume(); reject(new Error('Image source returned an error')); return; }
				const length = Number(response.headers['content-length'] ?? 0);
				if (length > 20 * 1024 * 1024) { response.destroy(); reject(new Error('Image exceeds the size limit')); return; }
				const chunks: Buffer[] = []; let total = 0;
				response.on('data', (chunk: Buffer) => { total += chunk.length; if (total > 20 * 1024 * 1024) { response.destroy(); reject(new Error('Image exceeds the size limit')); } else chunks.push(chunk); });
				response.on('end', () => resolve({ body: Buffer.concat(chunks) }));
				response.on('error', reject);
			});
			req.on('error', reject); req.end();
		});
		if (result.body) return result.body;
		if (!result.location || redirects === 4) throw new Error('Too many redirects');
		current = new URL(result.location, current);
	}
	throw new Error('Too many redirects');
}
