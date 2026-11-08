export function sniffImageType(data: Uint8Array): string | null {
	const starts = (signature: number[]) => signature.every((byte, i) => data[i] === byte);
	if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
	if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
	const ascii = (start: number, end: number) => String.fromCharCode(...data.slice(start, end));
	if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'image/gif';
	if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
	return null;
}
import sharp from 'sharp';


export async function validateImage(data: Uint8Array): Promise<{ contentType: string; width: number; height: number }> {
	if (data.byteLength === 0 || data.byteLength > 20 * 1024 * 1024) throw new Error('Image exceeds the size limit');
	const contentType = sniffImageType(data);
	if (!contentType) throw new Error('Unsupported image format');
	try {
		const image = sharp(data, { limitInputPixels: 40_000_000, animated: true, failOn: 'warning' });
		const metadata = await image.metadata();
		if (!metadata.width || !metadata.height) throw new Error('Image dimensions missing');
		await image.clone().resize(1, 1).png().toBuffer();
		const height = metadata.pageHeight ?? metadata.height;
		const rotated = (metadata.orientation ?? 1) >= 5;
		return { contentType, width: rotated ? height : metadata.width, height: rotated ? metadata.width : height };
	} catch {
		throw new Error('Invalid or unsupported image');
	}
}
