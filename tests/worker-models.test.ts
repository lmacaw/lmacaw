import { expect, test } from 'bun:test';
import { analyzeImage, embedQuery } from '../worker/models';
import sharp from 'sharp';

test('generates image metadata and uses a document embedding prefix', async () => {
	const calls: { url: string; body: Record<string, unknown> }[] = [];
	const fetcher = async (url: string | URL, init?: RequestInit) => {
		const body = JSON.parse(String(init?.body)); calls.push({ url: String(url), body });
		return new Response(JSON.stringify(String(url).endsWith('/api/generate') ? { response: JSON.stringify({ description: 'A cat', extracted_text: 'hello', tags: ['cat'] }) } : { embeddings: [Array(768).fill(0.1)] }));
	};
	const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).png().toBuffer();
	const result = await analyzeImage(image, { ollamaUrl: 'http://localhost:11434', visionModel: 'vision', embeddingModel: 'embed' }, fetcher);
	expect(result.description).toBe('A cat');
	expect(result.tags).toEqual(['cat']);
	expect(String(calls[1].body.input)).toStartWith('search_document: ');
	expect(calls[1].body.keep_alive).toBe('1h');
	const vision = calls[0].body as { format: { properties: { tags: { maxItems: number } } }; options: { num_predict: number } };
	expect(vision.format.properties.tags.maxItems).toBe(8);
	expect(vision.options.num_predict).toBeGreaterThan(0);
	await embedQuery('mèo', { ollamaUrl: 'http://localhost:11434', visionModel: 'vision', embeddingModel: 'embed' }, fetcher);
	expect(String(calls[2].body.input)).toBe('search_query: mèo');
});

test('retries in plain JSON mode when schema decoding returns nothing', async () => {
	const formats: unknown[] = [];
	const fetcher = async (url: string | URL, init?: RequestInit) => {
		const body = JSON.parse(String(init?.body));
		if (String(url).endsWith('/api/embed')) return new Response(JSON.stringify({ embeddings: [Array(768).fill(0.1)] }));
		formats.push(body.format);
		// Ollama's reply when llama.cpp rejects the grammar mid-generation.
		if (typeof body.format === 'object') return new Response(JSON.stringify({ model: '', response: '', done: false }));
		return new Response(JSON.stringify({ response: JSON.stringify({ description: 'A dog', extracted_text: '', tags: ['dog', 'dog', ' pet ', '', 'a', 'b', 'c', 'd', 'e', 'f', 'g'] }) }));
	};
	const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#000000' } }).png().toBuffer();
	const result = await analyzeImage(image, { ollamaUrl: 'http://localhost:11434', visionModel: 'vision', embeddingModel: 'embed' }, fetcher);
	expect(formats.map((format) => typeof format)).toEqual(['object', 'string']);
	expect(result.description).toBe('A dog');
	expect(result.tags).toEqual(['dog', 'pet', 'a', 'b', 'c', 'd', 'e', 'f']);
});
