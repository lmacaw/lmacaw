import type { ModelConfig } from './models';

export function workerConfig(env: Record<string, string | undefined>): ModelConfig & { serverUrl: string; token: string } {
	if (!env.LMACAW_URL || !env.AI_WORKER_TOKEN) throw new Error('LMACAW_URL and AI_WORKER_TOKEN are required');
	const url = new URL(env.LMACAW_URL);
	const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
	if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('LMACAW_URL must be an HTTPS origin or local HTTP origin');
	return { serverUrl: url.origin, token: env.AI_WORKER_TOKEN, ollamaUrl: env.OLLAMA_URL || 'http://127.0.0.1:11434', visionModel: env.AI_VISION_MODEL || 'qwen2.5vl:3b', embeddingModel: env.AI_EMBEDDING_MODEL || 'nomic-embed-text-v2-moe' };
}
