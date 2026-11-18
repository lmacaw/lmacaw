const iterations = 100_000;
const saltBytes = 16;
const hashBytes = 32;
const encoder = new TextEncoder();

function encode(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decode(value: string): Uint8Array<ArrayBuffer> {
	return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0));
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
	const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
	const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, hashBytes * 8);
	return new Uint8Array(bits);
}

export function validPassword(password: unknown): password is string {
	if (typeof password !== 'string' || password.length < 12 || password.length > 2048) return false;
	const length = Array.from(password).length;
	return length >= 12 && length <= 1024;
}

export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(saltBytes));
	return `pbkdf2$${iterations}$${encode(salt)}$${encode(await derive(password, salt))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	try {
		const match = /^pbkdf2\$100000\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/.exec(stored);
		if (!match || match[0] !== stored) return false;
		const [, saltText, hashText] = match;
		const salt = decode(saltText);
		const expected = decode(hashText);
		if (encode(salt) !== saltText || encode(expected) !== hashText) return false;

		const actual = await derive(password, salt);
		let difference = 0;
		for (let i = 0; i < hashBytes; i++) difference |= actual[i] ^ expected[i];
		return difference === 0;
	} catch {
		return false;
	}
}
