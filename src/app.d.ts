import type { CacheStorage, ExecutionContext } from '@cloudflare/workers-types';
import type { User } from './lib/server/auth';
import type { Env } from './lib/server/env';

declare global {
	namespace App {
		interface Locals {
			user: User | null;
		}

		interface Platform {
			env: Env;
			ctx: ExecutionContext;
			caches: CacheStorage;
		}
	}
}

export {};
