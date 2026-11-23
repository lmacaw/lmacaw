import { expect, test } from '@playwright/test';

// Runs as an anonymous visitor in public mode (the wrangler.jsonc default), so it needs no database setup.
test('a failed first load shows an inline message with a working retry', async ({ page }) => {
	let fail = true;
	await page.route('**/api/v1/items?*', (route) => (fail ? route.fulfill({ status: 503, body: 'unavailable' }) : route.fulfill({ json: { items: [], hasMore: false, semanticAvailable: true } })));
	await page.goto('/');
	const main = page.getByRole('main');
	await expect(main.getByText('Could not load memes.')).toBeVisible();
	fail = false;
	await main.getByRole('button', { name: 'Retry' }).click();
	await expect(main.getByText('Nothing shared yet.')).toBeVisible();
	await expect(main.getByRole('button', { name: 'Retry' })).toHaveCount(0);
});
