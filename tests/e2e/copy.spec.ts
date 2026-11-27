import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';

// Copying writes a PNG to the clipboard in Chromium, Firefox, and WebKit. Playwright can grant
// clipboard permissions only in Chromium (read and write) and WebKit (read); Firefox needs none
// for a write made inside a click, and allows reading back in automation.
async function allowClipboard(context: BrowserContext, browserName: string) {
	if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	if (browserName === 'webkit') await context.grantPermissions(['clipboard-read']);
}
const clipboardImage = (page: Page) => page.evaluate(async () => {
	for (const entry of await navigator.clipboard.read()) {
		if (!entry.types.includes('image/png')) continue;
		const bitmap = await createImageBitmap(await entry.getType('image/png'));
		return `${bitmap.width}x${bitmap.height}`;
	}
	return null;
});

async function signInWith(page: Page, image: { name: string; mimeType: string; buffer: Buffer }) {
	await page.goto('/');
	await page.getByLabel('Email').fill('admin@example.com');
	await page.getByLabel('Password').fill('a long admin password');
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeEnabled();
	await page.locator('input[type=file]').setInputFiles(image);
	await page.getByRole('button', { name: /^Add \d+$/ }).click();
	await expect(page.locator('[data-meme-tile]')).toHaveCount(1);
}
const png = async () => ({ name: 'copy.png', mimeType: 'image/png', buffer: await sharp({ create: { width: 6, height: 5, channels: 3, background: '#b4704c' } }).png().toBuffer() });

test.beforeEach(() => {
	const database = process.env.DATABASE_URL;
	if (!database || !new URL(database).pathname.endsWith('_e2e_test')) throw new Error('End-to-end tests require a dedicated _e2e_test database');
	execFileSync('bun', ['-e', 'import {SQL} from "bun"; const s = new SQL(process.env.DATABASE_URL); await s`DELETE FROM items WHERE owner_id IN (SELECT id FROM users WHERE email = ${"admin@example.com"})`; await s`DELETE FROM login_attempts`; await s.close();'], { env: process.env });
});

test('copy writes a PNG from the detail view and from a tile', async ({ page, context, browserName }) => {
	await allowClipboard(context, browserName);
	await signInWith(page, await png());
	await page.locator('[data-meme-tile]').first().click();
	await page.getByRole('button', { name: 'Copy image' }).click();
	await expect(page.getByRole('dialog').getByRole('status')).toHaveText('Copied.');
	await expect.poll(() => clipboardImage(page)).toBe('6x5');
	await page.getByRole('button', { name: 'Close', exact: true }).click();
	await page.evaluate(() => navigator.clipboard.writeText('cleared').catch(() => {}));
	await page.locator('[data-meme-tile]').first().hover();
	await page.getByRole('button', { name: 'Copy meme' }).click();
	await expect(page.getByRole('status')).toHaveText('Copied.');
	await expect.poll(() => clipboardImage(page)).toBe('6x5');
});

test('copy keeps working when the image is slow to load', async ({ page, context, browserName }) => {
	// Firefox and Safari only allow a clipboard write that starts inside the click. Firefox's
	// allowance lasts five seconds, so a later write would be rejected.
	test.setTimeout(45000);
	await allowClipboard(context, browserName);
	await signInWith(page, await png());
	await page.route((url) => url.pathname.endsWith('/media') && !url.search, async (route) => {
		await new Promise((resolve) => setTimeout(resolve, 6000));
		await route.continue();
	});
	await page.locator('[data-meme-tile]').first().click();
	await page.getByRole('button', { name: 'Copy image' }).click();
	await expect(page.getByRole('dialog').getByRole('status')).toHaveText('Copied.', { timeout: 15000 });
	await expect.poll(() => clipboardImage(page)).toBe('6x5');
});

const animatedGif = () => {
	const frames = Buffer.concat([Buffer.alloc(4 * 4 * 3, 0x40), Buffer.alloc(4 * 4 * 3, 0xc0)]);
	return sharp(frames, { raw: { width: 4, height: 8, channels: 3, pageHeight: 4 } as never }).gif({ loop: 0, delay: [100, 100] }).toBuffer();
};

test('an animated GIF copies its first frame and says so', async ({ page, context, browserName }) => {
	await allowClipboard(context, browserName);
	// Without file sharing (Firefox, Chromium on Linux) a GIF still copies its first frame.
	await page.addInitScript(() => { delete (Navigator.prototype as { canShare?: unknown }).canShare; });
	await signInWith(page, { name: 'loop.gif', mimeType: 'image/gif', buffer: await animatedGif() });
	await page.locator('[data-meme-tile]').first().click();
	await page.getByRole('button', { name: 'Copy image' }).click();
	await expect(page.getByRole('dialog').getByRole('status')).toHaveText('Copied first frame. Download to keep the animation.');
	await expect.poll(() => clipboardImage(page)).toBe('4x4');
});

test('where files can be shared, a GIF shares its prefetched animated original', async ({ page }) => {
	// iOS Safari only shares inside the tap, so a tap before the original has loaded asks for another.
	await page.addInitScript(() => {
		const shared: string[] = [];
		Object.assign(window, { shared });
		navigator.canShare = () => true;
		navigator.share = (data) => {
			const file = data?.files?.[0];
			if (file) shared.push(`${file.type} ${file.size}`);
			return Promise.reject(new DOMException('Cancelled', 'AbortError'));
		};
	});
	const sharedCount = () => page.evaluate(() => (window as unknown as { shared: string[] }).shared.length);
	const gif = await animatedGif();
	await signInWith(page, { name: 'loop.gif', mimeType: 'image/gif', buffer: gif });
	await page.route((url) => url.pathname.endsWith('/media') && !url.search, async (route) => {
		await new Promise((resolve) => setTimeout(resolve, 1500));
		await route.continue();
	});
	await page.locator('[data-meme-tile]').first().click();
	const share = page.getByRole('dialog').getByRole('button', { name: 'Share GIF' });
	await share.click();
	await expect(page.getByRole('dialog').getByRole('status')).toHaveText('Preparing GIF… tap again to share.');
	expect(await sharedCount()).toBe(0);
	await expect(async () => { await share.click(); expect(await sharedCount()).toBe(1); }).toPass({ timeout: 10000 });
	expect(await page.evaluate(() => (window as unknown as { shared: string[] }).shared)).toEqual([`image/gif ${gif.length}`]);
	await page.getByRole('button', { name: 'Close', exact: true }).click();
	// The tile shares the cached original on the first tap; cancelling the sheet is not an error.
	await page.locator('[data-meme-tile]').first().hover();
	await expect(page.getByRole('button', { name: 'Copy meme' })).toHaveCount(0);
	await page.getByRole('button', { name: 'Share GIF' }).click();
	await expect.poll(sharedCount).toBe(2);
	await expect(page.getByRole('status')).not.toHaveText(/Could not share/);
});

test('without clipboard support the interface says so and offers download', async ({ page }) => {
	// Matches older browsers and Lmacaw served over plain HTTP on a LAN address.
	await page.addInitScript(() => { delete (window as { ClipboardItem?: unknown }).ClipboardItem; });
	await signInWith(page, await png());
	await page.locator('[data-meme-tile]').first().hover();
	await expect(page.getByRole('button', { name: 'Copy meme' })).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Download meme' })).toHaveAttribute('download', '');
	await page.locator('[data-meme-tile]').first().click();
	await expect(page.getByRole('button', { name: 'Copy image' })).toHaveCount(0);
	await expect(page.getByRole('dialog')).toContainText('This browser cannot copy images. Use Download instead.');
	await expect(page.getByRole('link', { name: 'Download', exact: true })).toBeVisible();
});

test('a refused clipboard write offers download', async ({ page }) => {
	await page.addInitScript(() => { navigator.clipboard.write = () => Promise.reject(new DOMException('Denied', 'NotAllowedError')); });
	await signInWith(page, await png());
	await page.locator('[data-meme-tile]').first().hover();
	await page.getByRole('button', { name: 'Copy meme' }).click();
	await expect(page.getByRole('status')).toContainText('Could not copy. Download the original instead.');
	await expect(page.getByRole('status').getByRole('link', { name: 'Download' })).toHaveAttribute('href', /\/api\/v1\/items\/.+\/media$/);
});
