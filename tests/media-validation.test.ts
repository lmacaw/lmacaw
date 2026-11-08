import { expect, test } from 'bun:test';
import { sniffImageType, validateImage } from '../src/lib/server/media-validation';
import sharp from 'sharp';

test('recognizes supported image signatures regardless of filename', () => {
	expect(sniffImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
	expect(sniffImageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
	expect(sniffImageType(new TextEncoder().encode('GIF89a'))).toBe('image/gif');
	expect(sniffImageType(new TextEncoder().encode('RIFF1234WEBP'))).toBe('image/webp');
});

test('rejects unsupported and misleading image data', () => {
	expect(sniffImageType(new TextEncoder().encode('<svg></svg>'))).toBeNull();
	expect(sniffImageType(new TextEncoder().encode('RIFF1234HTML'))).toBeNull();
	expect(sniffImageType(new Uint8Array())).toBeNull();
});

test('requires a decodable image rather than trusting a signature', async () => {
	const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).png().toBuffer();
	expect(await validateImage(png)).toMatchObject({ contentType: 'image/png', width: 2, height: 2 });
	await expect(validateImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).rejects.toThrow();
});
