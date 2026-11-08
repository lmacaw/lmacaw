import sharp from 'sharp';

export type ModelConfig = { ollamaUrl: string; visionModel: string; embeddingModel: string };
type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

async function embed(text: string, config: ModelConfig, fetcher: Fetcher): Promise<number[]> {
	const response = await fetcher(new URL('/api/embed', config.ollamaUrl), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: config.embeddingModel, input: text }), signal: AbortSignal.timeout(240_000) });
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

export async function analyzeImage(bytes: Uint8Array, config: ModelConfig, fetcher: Fetcher = fetch) {
	const image = await sharp(bytes, { page: 0, limitInputPixels: 40_000_000 }).rotate().resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
	const response = await fetcher(new URL('/api/generate', config.ollamaUrl), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: config.visionModel, prompt: 'Describe this meme and transcribe any visible text. Return JSON with description, extracted_text, and tags (an array of short strings).', images: [image.toString('base64')], stream: false, format: 'json' }), signal: AbortSignal.timeout(240_000) });
	if (!response.ok) throw new Error('Vision request failed');
	const body = await response.json() as { response?: string };
	const result = JSON.parse(body.response ?? '{}') as Record<string, unknown>;
	if (typeof result.description !== 'string' || typeof result.extracted_text !== 'string' || !Array.isArray(result.tags) || result.tags.some((tag) => typeof tag !== 'string')) throw new Error('Invalid vision output');
	const description = result.description.slice(0, 4000), extractedText = result.extracted_text.slice(0, 4000);
	const tags = (result.tags as string[]).slice(0, 30).map((tag) => tag.slice(0, 60));
	const embedding = await embedDocument(`${description} ${extractedText} ${tags.join(' ')}`, config, fetcher);
	return { description, extractedText, tags, embedding, model: config.embeddingModel };
}
