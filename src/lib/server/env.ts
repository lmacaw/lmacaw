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
};

export function getEnv(platform: App.Platform | undefined): Env {
	if (!platform?.env) throw new Error('Bindings unavailable');
	return platform.env;
}
