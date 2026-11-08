import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './tests/e2e',
	workers: 1,
	use: { baseURL: 'http://127.0.0.1:4173' },
	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'] } },
		{ name: 'firefox', use: { ...devices['Desktop Firefox'] } },
		{ name: 'webkit', use: { ...devices['Desktop Safari'] } }
	],
	webServer: {
		command: 'bun run dev --host 127.0.0.1 --port 4173',
		env: { ...process.env, AI_WORKER_TOKEN: 'local-e2e-worker-token' },
		url: 'http://127.0.0.1:4173',
		reuseExistingServer: false,
		timeout: 30000
	}
});
