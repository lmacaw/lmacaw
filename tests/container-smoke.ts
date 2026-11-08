import sharp from 'sharp';

const origin = process.env.SMOKE_ORIGIN;
if (!origin || !['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw new Error('SMOKE_ORIGIN must be a local test server');
const login = await fetch(`${origin}/api/v1/session`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ email: 'admin@example.com', password: 'a long admin password' }) });
if (!login.ok) throw new Error(`Login failed: ${login.status}`);
const cookie = login.headers.get('set-cookie')?.split(';')[0];
if (!cookie) throw new Error('Session missing');
if (process.argv[2] === 'create') {
	const image = await sharp({ create: { width: 7, height: 7, channels: 3, background: '#765d32' } }).png().toBuffer();
	const form = new FormData(); form.set('file', new File([image], 'smoke.png', { type: 'image/png' }));
	const response = await fetch(`${origin}/api/v1/items`, { method: 'POST', headers: { cookie, origin }, body: form });
	if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
	console.log('Created test meme');
} else if (process.argv[2] === 'verify') {
	const response = await fetch(`${origin}/api/v1/items`, { headers: { cookie } });
	const data = await response.json() as { items: { id: string }[] };
	if (!response.ok || data.items.length !== 1) throw new Error('Expected one persisted test meme');
	const image = await fetch(`${origin}/api/v1/items/${data.items[0].id}/media`, { headers: { cookie } });
	if (!image.ok || !(await image.arrayBuffer()).byteLength) throw new Error('Persisted image unavailable');
	console.log('Verified database and image');
} else throw new Error('Expected create or verify');
