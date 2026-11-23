import { sniffImageType } from './media-validation';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const SIGNATURE_BYTES = 12;
// Some hosts (Wikimedia among them) refuse requests that carry no User-Agent.
const REQUEST_HEADERS = { 'user-agent': 'Lmacaw/1.0 (+https://github.com/lmacaw/lmacaw)', accept: 'image/*' };
type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

function isBlockedIPv4(first: number, second: number): boolean {
	return first === 0 || first === 10 || first === 127 || first >= 224 ||
		(first === 100 && second >= 64 && second <= 127) ||
		(first === 169 && second === 254) ||
		(first === 172 && second >= 16 && second <= 31) ||
		(first === 192 && second === 168);
}

export function isBlockedHost(hostname: string): boolean {
	// WHATWG URL parsing normalizes integer IPv4 and expanded or mapped IPv6 literals.
	const unbracketed = hostname.includes(':') && !hostname.startsWith('[');
	const address = unbracketed ? `[${hostname}]` : hostname;
	let host: string;
	try {
		host = new URL(`http://${address}`).hostname.replace(/\.$/, '');
	} catch {
		return true;
	}

	if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
	if (host.startsWith('[')) {
		const ip = host.slice(1, -1);
		if (ip === '::' || ip === '::1') return true;
		const mapped = /^::ffff:([a-f0-9]+):[a-f0-9]+$/.exec(ip);
		if (mapped) {
			const prefix = Number.parseInt(mapped[1], 16);
			return isBlockedIPv4(prefix >> 8, prefix & 0xff);
		}
		const prefix = Number.parseInt(ip.split(':', 1)[0], 16);
		return (prefix & 0xfe00) === 0xfc00 || (prefix & 0xffc0) === 0xfe80 || (prefix & 0xff00) === 0xff00;
	}

	if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
		const [first, second] = host.split('.').map(Number);
		return isBlockedIPv4(first, second);
	}
	return false;
}

function parseUrl(input: string, base?: URL): URL {
	let url: URL;
	try {
		url = new URL(input, base);
	} catch {
		throw new Error('Invalid URL');
	}
	if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
		throw new Error('Invalid URL');
	}
	// Workers lack DNS resolution. Cloudflare egress cannot reach private networks, so
	// these literal hostname checks provide defense in depth at each redirect.
	if (isBlockedHost(url.hostname)) throw new Error('Destination is not public');
	return url;
}

async function imageResponse(body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<Response> {
	const reader = body.getReader();
	const signature = new Uint8Array(SIGNATURE_BYTES);
	const prefetched: Uint8Array[] = [];
	let size = 0;
	let signatureSize = 0;
	let type: string | null = null;

	async function readChunk(): Promise<Uint8Array | undefined> {
		signal.throwIfAborted();
		const { value, done } = await reader.read();
		signal.throwIfAborted();
		if (done) return;
		size += value.byteLength;
		if (size > MAX_IMAGE_BYTES) throw new Error('Image exceeds the size limit');
		return value;
	}

	try {
		while (signatureSize < SIGNATURE_BYTES && !type) {
			const chunk = await readChunk();
			if (!chunk) break;
			if (!chunk.byteLength) continue;
			prefetched.push(chunk);
			const head = chunk.subarray(0, SIGNATURE_BYTES - signatureSize);
			signature.set(head, signatureSize);
			signatureSize += head.byteLength;
			type = sniffImageType(signature.subarray(0, signatureSize));
		}
		if (!type) throw new Error('Invalid image');
	} catch (error) {
		void reader.cancel(error).catch(() => {});
		throw error;
	}

	const stream = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				signal.throwIfAborted();
				const chunk = prefetched.shift() ?? await readChunk();
				if (chunk) controller.enqueue(chunk);
				else controller.close();
			} catch (error) {
				void reader.cancel(error).catch(() => {});
				controller.error(error);
			}
		},
		cancel: (reason) => reader.cancel(reason)
	}, { highWaterMark: 0 });
	return new Response(stream, { headers: { 'content-type': type, 'cache-control': 'no-store' } });
}

export async function fetchPublicImage(input: string, fetcher: Fetcher = fetch): Promise<Response> {
	const signal = AbortSignal.timeout(15_000);
	let url = parseUrl(input);
	for (let redirects = 0; ; redirects++) {
		signal.throwIfAborted();
		const response = await fetcher(url, { redirect: 'manual', signal, headers: REQUEST_HEADERS });
		const location = response.headers.get('location');
		if (response.status >= 300 && response.status < 400 && location) {
			void response.body?.cancel().catch(() => {});
			if (redirects === MAX_REDIRECTS) throw new Error('Too many redirects');
			url = parseUrl(location, url);
			continue;
		}
		if (response.status !== 200 || !response.body) {
			void response.body?.cancel().catch(() => {});
			throw new Error('Image source returned an error');
		}
		if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) {
			void response.body.cancel().catch(() => {});
			throw new Error('Image exceeds the size limit');
		}
		return imageResponse(response.body, signal);
	}
}
