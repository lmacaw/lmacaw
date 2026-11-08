import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';

// Fails on serious or critical axe violations; reports the rest so they stay visible.
async function audit(page: Page, label: string) {
	const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
	for (const violation of violations) console.log(`[axe ${label}] ${violation.impact} ${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`);
	expect.soft(violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical').map((violation) => `${violation.id} ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`), label).toEqual([]);
}

async function signIn(page: Page) {
	await page.goto('/');
	await page.getByLabel('Email').fill('admin@example.com');
	await page.getByLabel('Password').fill('a long admin password');
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeEnabled();
}

test.beforeEach(() => {
	const database = process.env.DATABASE_URL;
	if (!database || !new URL(database).pathname.endsWith('_e2e_test')) throw new Error('End-to-end tests require a dedicated _e2e_test database');
	execFileSync('bun', ['-e', 'import {SQL} from "bun"; const s = new SQL(process.env.DATABASE_URL); await s`DELETE FROM items WHERE owner_id IN (SELECT id FROM users WHERE email = ${"admin@example.com"})`; await s`DELETE FROM collections WHERE owner_id IN (SELECT id FROM users WHERE email = ${"admin@example.com"})`; await s`DELETE FROM login_attempts`; await s.close();'], { env: process.env });
});

for (const colorScheme of ['light', 'dark'] as const) {
	for (const width of [375, 1280]) {
		test(`main screens pass axe in ${colorScheme} at ${width}px`, async ({ page }) => {
			await page.setViewportSize({ width, height: width < 720 ? 812 : 800 });
			await page.emulateMedia({ colorScheme });
			test.setTimeout(90000);
			const tag = `${colorScheme} ${width}`;

			await page.goto('/');
			await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
			await audit(page, `sign-in ${tag}`);

			await signIn(page);
			await audit(page, `empty library ${tag}`);
			const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#4c70b4' } }).png().toBuffer();
			await page.locator('input[type=file]').setInputFiles({ name: 'axe.png', mimeType: 'image/png', buffer: image });
			await expect(page.locator('[data-meme-tile]')).toHaveCount(1);
			if (width < 720) await page.getByRole('button', { name: 'Menu', exact: true }).click();
			await page.getByRole('button', { name: 'New collection' }).click();
			await page.getByLabel('Collection name').fill('Audit');
			await page.getByRole('button', { name: 'Create', exact: true }).click();
			await expect(page.getByRole('dialog')).toHaveCount(0);
			if (width < 720) await page.keyboard.press('Escape');
			await audit(page, `library ${tag}`);

			if (width < 720) {
				await page.getByRole('button', { name: 'Menu', exact: true }).click();
				await expect(page.getByRole('button', { name: 'Library', exact: true })).toBeFocused();
				await audit(page, `open menu ${tag}`);
				await page.keyboard.press('Escape');
				await expect(page.getByRole('button', { name: 'Favorites', exact: true })).toBeHidden();
				await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeFocused();
			}

			await page.locator('[data-meme-tile]').first().click();
			await expect(page.getByRole('dialog', { name: 'Meme details' })).toBeVisible();
			await expect(page.getByRole('checkbox', { name: 'Audit' })).toBeVisible();
			await audit(page, `detail ${tag}`);
			await page.getByRole('button', { name: 'Close', exact: true }).click();

			await page.getByRole('button', { name: 'Add URL' }).click();
			await expect(page.getByRole('dialog', { name: 'Add URL' })).toBeVisible();
			await audit(page, `URL dialog ${tag}`);
			await page.getByLabel('Image URL').fill('http://127.0.0.1/private');
			await page.getByRole('button', { name: 'Import', exact: true }).click();
			await expect(page.getByRole('alert')).toBeVisible();
			await audit(page, `URL dialog error ${tag}`);
			await page.getByRole('button', { name: 'Cancel' }).click();

			if (width < 720) await page.getByRole('button', { name: 'Menu', exact: true }).click();
			await page.getByRole('button', { name: 'New collection' }).click();
			await expect(page.getByRole('dialog', { name: 'New collection' })).toBeVisible();
			await audit(page, `collection dialog ${tag}`);
			await page.getByRole('button', { name: 'Cancel' }).click();

			const thumbnail = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#a0703f' } }).png().toBuffer();
			await page.route('https://api.openverse.org/**', (route) => route.fulfill({ contentType: 'image/png', body: thumbnail }));
			await page.route('**/api/v1/discover?q=cat', (route) => route.fulfill({ json: { items: [{ id: '067e6162-3b6f-4ae2-a171-2470b63dff00', title: 'Cat', thumbnail: '', attribution: 'Cat by A' }] } }));
			await page.getByRole('button', { name: 'Discover' }).click();
			await audit(page, `discover empty ${tag}`);
			await page.getByLabel('Search').fill('cat');
			await page.getByLabel('Search').press('Enter');
			await expect(page.getByRole('button', { name: 'Save Cat' })).toBeAttached();
			await audit(page, `discover results ${tag}`);
		});
	}
}

test('controls are at least 44 px on a touch screen', async ({ browser, browserName }) => {
	test.skip(browserName === 'firefox', 'Playwright cannot emulate a touch screen (isMobile) in Firefox');
	const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
	const page = await context.newPage();
	await signIn(page);
	expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
	const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#70b44c' } }).png().toBuffer();
	await page.locator('input[type=file]').setInputFiles({ name: 'touch.png', mimeType: 'image/png', buffer: image });
	await expect(page.locator('[data-meme-tile]')).toHaveCount(1);
	const small = () => page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, label.check'))
		.filter((element) => element.checkVisibility() && !element.closest('.check') && !element.closest('.source-links') && element.getAttribute('type') !== 'file')
		.map((element) => ({ element, box: element.getBoundingClientRect() }))
		.filter(({ element, box }) => (element.matches('input, textarea, select') ? box.height : Math.min(box.width, box.height)) < 44)
		.map(({ element, box }) => `${element.getAttribute('aria-label') || element.textContent?.trim() || element.id} ${Math.round(box.width)}x${Math.round(box.height)}`));
	expect(await small(), 'library').toEqual([]);
	await page.getByRole('button', { name: 'Menu', exact: true }).click();
	await page.getByRole('button', { name: 'Invite' }).click();
	await expect(page.getByLabel('Invitation link')).toBeVisible();
	expect(await small(), 'menu').toEqual([]);
	await page.keyboard.press('Escape');
	await page.locator('[data-meme-tile]').first().tap();
	await expect(page.getByRole('dialog', { name: 'Meme details' })).toBeVisible();
	expect(await small(), 'detail').toEqual([]);
	await context.close();
});

test('reduced motion turns off transitions and animations', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.setViewportSize({ width: 375, height: 812 });
	await signIn(page);
	const durations = await page.evaluate(() => [document.querySelector('.sidebar')!, document.querySelector('.button')!]
		.map((element) => getComputedStyle(element).transitionDuration.split(',').every((value) => parseFloat(value) === 0)));
	expect(durations).toEqual([true, true]);
});
