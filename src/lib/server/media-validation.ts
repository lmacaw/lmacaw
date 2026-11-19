export function sniffImageType(data: Uint8Array): string | null {
	const starts = (signature: number[]) => signature.every((byte, i) => data[i] === byte);
	if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
	if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
	const ascii = (start: number, end: number) => String.fromCharCode(...data.slice(start, end));
	if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'image/gif';
	if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
	return null;
}

export function isThumbnailType(bytes: Uint8Array): boolean {
	const type = sniffImageType(bytes);
	return type === 'image/webp' || type === 'image/jpeg';
}
