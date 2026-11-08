import sharp from 'sharp';

export type ModelConfig = { ollamaUrl: string; visionModel: string; embeddingModel: string };
type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

// keep_alive: a cold model load (about 5 s on an RTX 3070 Ti) exceeds the server's 4 s wait for a
// search embedding, so the first search after idle would otherwise fall back to keywords.
async function embed(text: string, config: ModelConfig, fetcher: Fetcher): Promise<number[]> {
	const response = await fetcher(new URL('/api/embed', config.ollamaUrl), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: config.embeddingModel, input: text, keep_alive: '1h' }), signal: AbortSignal.timeout(240_000) });
	if (!response.ok) throw new Error('Embedding request failed');
	const body = await response.json() as { embeddings?: number[][] };
	const vector = body.embeddings?.[0];
	if (!vector || vector.length !== 768 || vector.some((value) => typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Invalid embedding');
	return vector;
}

export function embedQuery(query: string, config: ModelConfig, fetcher: Fetcher = fetch): Promise<number[]> {
	return embed(`search_query: ${query}`, config, fetcher);
}

export function embedDocument(text: string, config: ModelConfig, fetcher: Fetcher = fetch): Promise<number[]> {
	return embed(`search_document: ${text}`.slice(0, 8000), config, fetcher);
}

const VISION_PROMPT = 'Describe this meme in one or two sentences, transcribe any visible text exactly as written (keep spelling, slang, and line breaks; do not correct it), and give up to 8 distinct short tags. Return JSON with description, extracted_text, and tags.';
// A schema with a tag limit, a token cap, and a repeat penalty stop small vision models from
// looping on the tag list until the request times out (seen with qwen2.5vl:3b on real photos).
const VISION_SCHEMA = { type: 'object', properties: { description: { type: 'string' }, extracted_text: { type: 'string' }, tags: { type: 'array', items: { type: 'string' }, maxItems: 8 } }, required: ['description', 'extracted_text', 'tags'] };
const VISION_OPTIONS = { num_predict: 600, temperature: 0, repeat_penalty: 1.15 };

type VisionResult = { description: string; extracted_text: string; tags: string[] };

async function describe(image: Buffer, format: unknown, config: ModelConfig, fetcher: Fetcher): Promise<VisionResult | null> {
	const response = await fetcher(new URL('/api/generate', config.ollamaUrl), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: config.visionModel, prompt: VISION_PROMPT, images: [image.toString('base64')], stream: false, format, options: VISION_OPTIONS }), signal: AbortSignal.timeout(240_000) });
	if (!response.ok) throw new Error('Vision request failed');
	const body = await response.json() as { response?: string };
	try {
		const result = JSON.parse(body.response ?? '') as Record<string, unknown>;
		if (typeof result.description === 'string' && typeof result.extracted_text === 'string' && Array.isArray(result.tags) && result.tags.every((tag) => typeof tag === 'string')) return result as VisionResult;
	} catch { /* empty or truncated output */ }
	return null;
}

export async function analyzeImage(bytes: Uint8Array, config: ModelConfig, fetcher: Fetcher = fetch) {
	const image = await sharp(bytes, { page: 0, limitInputPixels: 40_000_000 }).rotate().resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
	// Schema-constrained decoding sometimes fails inside llama.cpp ("Unexpected empty grammar
	// stack"), which Ollama 0.40 returns as an empty 200 response. Retry once with plain JSON mode.
	const result = (await describe(image, VISION_SCHEMA, config, fetcher)) ?? (await describe(image, 'json', config, fetcher));
	if (!result) throw new Error('Invalid vision output');
	const description = result.description.slice(0, 4000), extractedText = result.extracted_text.slice(0, 4000);
	const tags = [...new Set(result.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 8).map((tag) => tag.slice(0, 60));
	const embedding = await embedDocument(`${description} ${extractedText} ${tags.join(' ')}`, config, fetcher);
	return { description, extractedText, tags, embedding, model: config.embeddingModel };
}
