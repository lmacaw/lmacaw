import adapter from '@sveltejs/adapter-node';

// Every cookie-authenticated API route checks Origin against every ORIGIN address
// (src/lib/server/request.ts), so SvelteKit's single-origin form check is turned off.
export default { kit: { adapter: adapter(), csrf: { trustedOrigins: ['*'] } } };
