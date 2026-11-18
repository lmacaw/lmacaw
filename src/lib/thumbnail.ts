const MAX_THUMBNAIL_BYTES = 300 * 1024;

export function fitWithin(width: number, height: number, max = 768): { width: number; height: number } {
	const scale = Math.min(1, max / Math.max(width, height));
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale))
	};
}

async function makeThumbnail(bitmap: ImageBitmap): Promise<Blob> {
	const { width, height } = fitWithin(bitmap.width, bitmap.height);
	const canvas = typeof OffscreenCanvas === 'function'
		? new OffscreenCanvas(width, height)
		: document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Canvas unavailable');
	context.drawImage(bitmap, 0, 0, width, height);

	const encode = (type: string, quality: number) => 'convertToBlob' in canvas
		? canvas.convertToBlob({ type, quality })
		: new Promise<Blob>((resolve, reject) => {
			canvas.toBlob((blob) => {
				if (blob) resolve(blob);
				else reject(new Error('Could not encode thumbnail'));
			}, type, quality);
		});

	let type = 'image/webp';
	let thumbnail = await encode(type, 0.8);
	if (thumbnail.type !== type) {
		type = 'image/jpeg';
		thumbnail = await encode(type, 0.8);
	}
	for (const quality of [0.7, 0.6]) {
		if (thumbnail.size <= MAX_THUMBNAIL_BYTES) break;
		thumbnail = await encode(type, quality);
	}
	if (thumbnail.type !== type || thumbnail.size > MAX_THUMBNAIL_BYTES) {
		throw new Error('Could not encode thumbnail within the upload limit');
	}
	return thumbnail;
}

export async function prepareUpload(file: Blob): Promise<{ thumbnail: Blob; sha256: string; width: number; height: number }> {
	const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
	const { width, height } = bitmap;
	let thumbnail: Blob;
	try {
		thumbnail = await makeThumbnail(bitmap);
	} finally {
		bitmap.close();
	}

	const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
	const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
	return { thumbnail, sha256, width, height };
}
