import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';

test.beforeEach(() => {
	const database = process.env.DATABASE_URL;
	if (!database || !new URL(database).pathname.endsWith('_e2e_test')) throw new Error('End-to-end tests require a dedicated _e2e_test database');
	execFileSync('bun', ['-e', 'import {SQL} from "bun"; const s = new SQL(process.env.DATABASE_URL); await s`DELETE FROM items WHERE owner_id IN (SELECT id FROM users WHERE email = ${"admin@example.com"})`; await s`DELETE FROM collections WHERE owner_id IN (SELECT id FROM users WHERE email = ${"admin@example.com"})`; await s`DELETE FROM login_attempts`; await s.close();'], { env: process.env });
});

test('the library fits a narrow mobile viewport', async ({ page }) => {
	await page.setViewportSize({ width: 375, height: 812 });
	await page.goto('/');
	await page.getByLabel('Email').fill('admin@example.com');
	await page.getByLabel('Password').fill('a long admin password');
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeEnabled();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('an administrator can create an invitation for a new member', async ({ page, browser }) => {
	await page.goto('/');
	await page.getByLabel('Email').fill('admin@example.com');
	await page.getByLabel('Password').fill('a long admin password');
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeEnabled();
	await page.getByRole('button', { name: 'Invite' }).click();
	const link = await page.getByLabel('Invitation link').inputValue();
	const member = await browser.newPage();
	await member.goto(link);
	await member.getByLabel('Email').fill(`${crypto.randomUUID()}@example.com`);
	await member.getByLabel('Password').fill('a long member password');
	await member.getByRole('button', { name: 'Create account' }).click();
	await expect(member.getByText('Account created')).toBeVisible();
	await member.close();
});

test('signing out clears private state before another account signs in', async ({ page }) => {
	await page.goto('/');
	await page.getByLabel('Email').fill('admin@example.com');
	await page.getByLabel('Password').fill('a long admin password');
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeEnabled();
	await page.getByRole('button', { name: 'New collection' }).click();
	await page.getByLabel('Collection name').fill('Private Cats');
	await page.getByRole('button', { name: 'Create', exact: true }).click();
	await page.getByRole('button', { name: 'Invite' }).click();
	const link = await page.getByLabel('Invitation link').inputValue();
	const token = new URL(link).hash.slice(1);
	const email = `${crypto.randomUUID()}@example.com`;
	const registered = await page.request.post('/api/v1/register', { data: { token, email, password: 'a long member password' } });
	expect(registered.status()).toBe(201);
	await page.getByRole('button', { name: 'Sign out' }).click();
	await page.route('**/api/v1/collections', (route) => route.fulfill({ status: 503, body: 'unavailable' }));
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill('a long member password');
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page.getByRole('button', { name: 'Library', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Private Cats', exact: true })).toHaveCount(0);
	await expect(page.getByLabel('Invitation link')).toHaveCount(0);
});

test('a member can sign in, upload, and view a meme', async ({ page, browserName }) => {
	if (browserName === 'chromium') await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
	page.on('pageerror', (error) => console.error('Browser error:', error.message));
	await page.goto('/');
	await page.getByLabel('Email').fill('admin@example.com');
	await page.getByLabel('Password').fill('a long admin password');
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeEnabled();
	const image = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#b44c70' } }).png().toBuffer();
	await page.locator('input[type=file]').setInputFiles({ name: 'meme.png', mimeType: 'image/png', buffer: image });
	await expect(page.locator('[data-meme-tile]')).toHaveCount(1);
	await page.locator('[data-meme-tile]').first().click();
	await expect(page.getByRole('dialog')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Download' })).toBeVisible();
	await page.getByRole('button', { name: 'Close' }).click();
	const pasted = await sharp({ create: { width: 5, height: 5, channels: 3, background: '#394b67' } }).png().toBuffer();
	// A real clipboard write and keyboard paste: Firefox ignores data in synthetic paste events.
	await page.evaluate((bytes) => document.addEventListener('click', () => {
		(window as { written?: Promise<void> }).written = navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(bytes)], { type: 'image/png' }) })]);
	}, { once: true, capture: true }), Array.from(pasted));
	await page.getByRole('heading', { name: 'Library' }).click();
	await page.evaluate(() => (window as { written?: Promise<void> }).written);
	await page.keyboard.press('ControlOrMeta+V');
	await expect(page.locator('[data-meme-tile]')).toHaveCount(2);
	await page.locator('[data-meme-tile]').first().hover();
	await expect(page.getByRole('button', { name: 'Favorite meme' }).first()).toBeVisible();
	if (process.env.LMACAW_CAPTURE) await page.screenshot({ path: process.env.LMACAW_CAPTURE, fullPage: true });
	await page.getByRole('button', { name: 'New collection' }).click();
	await page.getByLabel('Collection name').fill('Cats');
	await page.getByRole('button', { name: 'Create', exact: true }).click();
	await page.locator('[data-meme-tile]').first().click();
	await page.getByLabel('Description').fill('A sleepy meme');
	await page.getByLabel('Tags').fill('cat, tired');
	await page.getByLabel('Text in image').fill('corrected text');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByRole('status')).toContainText('Saved');
	await page.getByRole('checkbox', { name: 'Cats' }).check();
	await page.getByRole('button', { name: 'Close', exact: true }).click();
	await page.getByRole('button', { name: 'Cats', exact: true }).click();
	await expect(page.locator('[data-meme-tile]')).toHaveCount(1);
	await page.locator('[data-meme-tile]').first().click();
	await expect(page.getByRole('checkbox', { name: 'Cats' })).toBeChecked();
	await page.getByRole('checkbox', { name: 'Cats' }).uncheck();
	await expect(page.locator('[data-meme-tile]')).toHaveCount(0);
	await page.getByRole('button', { name: 'Close', exact: true }).click();
	await page.getByRole('button', { name: 'Library', exact: true }).click();
	await page.locator('[data-meme-tile]').first().click();
	page.once('dialog', (prompt) => prompt.accept());
	await page.getByRole('button', { name: 'Delete', exact: true }).click();
	await expect(page.locator('[data-meme-tile]')).toHaveCount(1);
	await page.getByRole('button', { name: 'Add URL' }).click();
	await page.getByLabel('Image URL').fill('http://127.0.0.1/private');
	await page.getByRole('button', { name: 'Import', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText('could not be imported');
	await page.getByRole('button', { name: 'Cancel' }).click();
	await page.route('**/api/v1/discover?q=cat', (route) => route.fulfill({ json: { items: [{ id: '067e6162-3b6f-4ae2-a171-2470b63dff00', title: 'Cat', thumbnail: '', attribution: 'Cat by A' }] } }));
	await page.route('**/api/v1/discover/save', (route) => route.fulfill({ status: 201, json: { duplicate: false } }));
	await page.getByRole('button', { name: 'Discover' }).click();
	await page.getByLabel('Search').fill('cat');
	await page.getByLabel('Search').press('Enter');
	await expect(page.getByRole('button', { name: 'Save Cat' })).toBeVisible();
	await page.getByRole('button', { name: 'Save Cat' }).click();
	await expect(page.getByRole('status')).toContainText('Saved');
});

async function signIn(page: import('@playwright/test').Page) {
	await page.goto('/');
	await page.getByLabel('Email').fill('admin@example.com');
	await page.getByLabel('Password').fill('a long admin password');
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeEnabled();
}

test('unfavoriting inside Favorites keeps the open detail populated', async ({ page }) => {
	await signIn(page);
	const image = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#7a3fa0' } }).png().toBuffer();
	await page.locator('input[type=file]').setInputFiles({ name: 'fav.png', mimeType: 'image/png', buffer: image });
	await expect(page.locator('[data-meme-tile]')).toHaveCount(1);
	await page.locator('[data-meme-tile]').first().hover();
	await page.getByRole('button', { name: 'Favorite meme' }).click();
	await page.getByRole('button', { name: 'Favorites', exact: true }).click();
	await expect(page.locator('[data-meme-tile]')).toHaveCount(1);
	await page.locator('[data-meme-tile]').first().click();
	await page.getByRole('button', { name: 'Unfavorite', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Favorite', exact: true })).toBeVisible();
	await expect(page.getByRole('dialog').getByRole('img')).toBeVisible();
	await expect(page.getByLabel('Description')).toBeVisible();
	await page.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(page.locator('[data-meme-tile]')).toHaveCount(0);
});

test('collections can be renamed and deleted without losing memes', async ({ page }) => {
	await signIn(page);
	const image = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#3fa07a' } }).png().toBuffer();
	await page.locator('input[type=file]').setInputFiles({ name: 'keep.png', mimeType: 'image/png', buffer: image });
	await page.getByRole('button', { name: 'New collection' }).click();
	await page.getByLabel('Collection name').fill('Dogs');
	await page.getByRole('button', { name: 'Create', exact: true }).click();
	await page.getByRole('button', { name: 'Dogs', exact: true }).click();
	await page.getByRole('button', { name: 'Rename collection' }).click();
	await page.getByLabel('Collection name').fill('Good dogs');
	await page.getByRole('button', { name: 'Rename', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Good dogs' })).toBeVisible();
	page.once('dialog', (prompt) => prompt.accept());
	await page.getByRole('button', { name: 'Delete collection' }).click();
	await expect(page.getByRole('button', { name: 'Good dogs', exact: true })).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
	await expect(page.locator('[data-meme-tile]')).toHaveCount(1);
});

test('Add URL takes one link per line and keeps the ones that fail', async ({ page }) => {
	await signIn(page);
	await page.getByRole('button', { name: 'Add URL' }).click();
	await page.getByLabel('Image URLs').fill('http://127.0.0.1/one.png\n\n  http://127.0.0.1/two.png  \nhttp://127.0.0.1/one.png');
	await page.getByRole('button', { name: 'Import', exact: true }).click();
	await expect(page.getByRole('alert')).toHaveText(/2 links could not be imported/);
	await expect(page.getByLabel('Image URLs')).toHaveValue('http://127.0.0.1/one.png\nhttp://127.0.0.1/two.png');
});
