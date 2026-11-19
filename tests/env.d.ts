import type { D1Migration, ProvidedEnv } from 'cloudflare:test';
import type { Env } from '../src/lib/server/env';

declare module 'cloudflare:test' {
	interface ProvidedEnv extends Env {
		TEST_MIGRATIONS: D1Migration[];
	}
}

declare global {
	namespace Cloudflare {
		interface Env extends ProvidedEnv {}
	}
}
