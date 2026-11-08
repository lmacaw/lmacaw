import { expect, test } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import sharp from 'sharp';

test('worker processes an image and semantic search uses its result', async ({ page }) => {
	const database = process.env.DATABASE_URL;
	if (!database || !new URL(database).pathname.endsWith('_e2e_test')) throw new Error('A dedicated _e2e_test database is required');
	execFileSync('bun', ['-e', 'import {SQL} from "bun"; const s = new SQL(process.env.DATABASE_URL); await s`DELETE FROM items WHERE owner_id IN (SELECT id FROM users WHERE email = ${"admin@example.com"})`; await s`DELETE FROM login_attempts`; await s`DELETE FROM ai_jobs WHERE kind = ${"query"}`; await s`DELETE FROM worker_status`; await s.close();'], { env: process.env });
	const fake = createServer((req, res) => {
		res.setHeader('content-type', 'application/json');
		if (req.url === '/api/generate') res.end(JSON.stringify({ response: JSON.stringify({ description: 'sleepy cat', extracted_text: 'late meeting', tags: ['cat'] }) }));
		else res.end(JSON.stringify({ embeddings: [Array.from({ length: 768 }, (_, i) => i === 0 ? 1 : 0)] }));
	});
	await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
	const address = fake.address();
	if (!address || typeof address === 'string') throw new Error('No fake model port');
	const worker = spawn('bun', ['run', 'worker/index.ts'], { env: { ...process.env, LMACAW_URL: 'http://127.0.0.1:4173', AI_WORKER_TOKEN: 'local-e2e-worker-token', OLLAMA_URL: `http://127.0.0.1:${address.port}` }, stdio: 'ignore' });
	try {
		await page.goto('/');
		await page.getByLabel('Email').fill('admin@example.com');
		await page.getByLabel('Password').fill('a long admin password');
		await page.getByRole('button', { name: 'Sign in' }).click();
		await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeEnabled();
		const image = await sharp({ create: { width: 6, height: 6, channels: 3, background: '#3d6345' } }).png().toBuffer();
		await page.locator('input[type=file]').setInputFiles({ name: 'cat.png', mimeType: 'image/png', buffer: image });
		await expect.poll(async () => (await (await page.request.get('/api/v1/items')).json()).items[0]?.ai_description, { timeout: 12000 }).toBe('sleepy cat');
		const result = await (await page.request.get('/api/v1/items?q=spaceship', { timeout: 10000 })).json();
		expect(result.semanticAvailable).toBe(true);
		expect(result.items).toHaveLength(1);
		worker.kill();
		await new Promise<void>((resolve) => worker.once('exit', () => resolve()));
		// The server treats a worker as online for three minutes after its last contact; simulate that window passing.
		execFileSync('bun', ['-e', 'import {SQL} from "bun"; const s = new SQL(process.env.DATABASE_URL); await s`UPDATE worker_status SET last_seen = now() - make_interval(mins => 10)`; await s.close();'], { env: process.env });
		const fallback = await (await page.request.get('/api/v1/items?q=meeting', { timeout: 10000 })).json();
		expect(fallback.semanticAvailable).toBe(false);
		expect(fallback.items).toHaveLength(1);
	} finally { worker.kill(); fake.close(); }
});
