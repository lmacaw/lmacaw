import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) }
	},
	plugins: [
		cloudflareTest({
			main: './tests/worker.ts',
			wrangler: { configPath: './wrangler.jsonc' },
			remoteBindings: false,
			miniflare: {
				assets: { directory: './static' },
				bindings: {
					TEST_MIGRATIONS: await readD1Migrations('./migrations'),
					AI_MODE: 'fake',
					ORIGIN: 'http://localhost:4173',
					// wrangler.jsonc sets AUTH_MODE=public for lmacaw.meme; tests default to password mode and set public per test.
					AUTH_MODE: 'password'
				}
			}
		})
	],
	test: {
		include: ['tests/*.test.ts'],
		setupFiles: ['./tests/setup.ts']
	}
});
