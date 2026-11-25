import type { Ai, D1Database, R2Bucket, VectorizeIndex } from '@cloudflare/workers-types';
export type Env = {
	DB: D1Database;
	MEDIA: R2Bucket;
	AI: Ai;
	VECTORIZE: VectorizeIndex;
	ORIGIN: string;
	ADMIN_EMAIL?: string;
	MAIL_FROM?: string;
	RESEND_API_KEY?: string;
	R2_ACCOUNT_ID?: string;
	R2_BUCKET?: string;
	R2_ACCESS_KEY_ID?: string;
	R2_SECRET_ACCESS_KEY?: string;
	AI_MODE?: string;
	AI_DAILY_NEURONS?: string;
	VECTOR_LIMIT?: string;
	VECTOR_QUERIES_PER_DAY?: string;
	DEV_ENDPOINTS?: string;
	/** 'public' (lmacaw.meme: anonymous read-only, admins through Cloudflare Access) or 'password' (self-host, default). */
	AUTH_MODE?: string;
	/** Public mode: the host whose requests may carry a Cloudflare Access token, e.g. admin.lmacaw.meme. */
	ADMIN_HOST?: string;
	/** Public mode: the Zero Trust team domain, e.g. lmacaw.cloudflareaccess.com. */
	ACCESS_TEAM_DOMAIN?: string;
	/** Public mode: the Access application's audience tag. */
	ACCESS_AUD?: string;
	/** Optional secret: post every new original to this Discord webhook as an off-site backup. Unset = off. */
	DISCORD_BACKUP_WEBHOOK_URL?: string;
	/** Largest original to attach, in bytes (default 10 MiB, Discord's unboosted limit). Larger ones get a text notice. */
	DISCORD_BACKUP_MAX_BYTES?: string;
};

export type AuthMode = 'public' | 'password';

export function authMode(env: Pick<Env, 'AUTH_MODE'>): AuthMode {
	return env.AUTH_MODE === 'public' ? 'public' : 'password';
}

/** Mail is configured only when a Resend key is set; without it nothing tries to send. */
export function mailConfigured(env: Pick<Env, 'RESEND_API_KEY'>): boolean {
	return Boolean(env.RESEND_API_KEY);
}

export function getEnv(platform: App.Platform | undefined): Env {
	if (!platform?.env) throw new Error('Bindings unavailable');
	return platform.env;
}
