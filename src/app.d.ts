import type { CacheStorage, ExecutionContext } from '@cloudflare/workers-types';
import type { Env } from './lib/server/env';

declare global {
	namespace App {
		interface Locals {
			user: { id: string; email: string; isAdmin: boolean } | null;
		}

		interface Platform {
			env: Env;
			ctx: ExecutionContext;
			caches: CacheStorage;
		}
	}
}

export {};
