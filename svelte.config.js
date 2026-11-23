import { mkdirSync, writeFileSync } from 'node:fs';
import adapter from '@sveltejs/adapter-cloudflare';

// The adapter writes its worker to the wrangler config's `main`, but wrangler.jsonc's `main` is
// cloudflare/entry.ts, which wraps that worker to add the cron handler. So the adapter reads a
// small generated config that sends its output to .svelte-kit/cloudflare instead.
const config = '.svelte-kit/wrangler-adapter.json';
mkdirSync('.svelte-kit', { recursive: true });
writeFileSync(config, JSON.stringify({ main: 'cloudflare/_worker.js', assets: { directory: 'cloudflare', binding: 'ASSETS' } }));

// Every cookie-authenticated API route checks Origin against every ORIGIN address
// (src/lib/server/request.ts), so SvelteKit's single-origin form check is turned off.
export default {
	kit: { adapter: adapter({ config, platformProxy: { remoteBindings: false } }), csrf: { trustedOrigins: ['*'] } }
};
