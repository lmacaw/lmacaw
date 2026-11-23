import { expect, test } from '@playwright/test';

// Runs against the dev server in its default public mode (wrangler.jsonc sets AUTH_MODE=public).
test('a saved theme applies before any app script runs, on every page', async ({ page }) => {
	await page.emulateMedia({ colorScheme: 'light' });
	await page.addInitScript(() => localStorage.setItem('lmacaw-theme', 'dark'));
	// Block every script file so only inline code in app.html can set the theme.
	await page.route('**/*', (route) => (route.request().resourceType() === 'script' ? route.abort() : route.continue()));
	for (const path of ['/', '/about', '/signin', '/invite']) {
		await page.goto(path);
		await expect(page.locator('html'), path).toHaveAttribute('data-theme', 'dark');
	}
});

for (const width of [375, 1280]) {
	test(`a public visitor can switch the theme from the top bar at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 800 });
		await page.goto('/');
		const toggle = page.locator('.topbar').getByRole('button', { name: /^Appearance/ });
		await expect(toggle).toHaveAccessibleName('Appearance: System');
		await expect(toggle).toBeEnabled();
		await toggle.click();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
		await toggle.click();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
		await page.reload();
		await expect(toggle).toHaveAccessibleName('Appearance: Dark');
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	});
}
