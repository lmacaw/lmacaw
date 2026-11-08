import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { health } from '$lib/server/health';

export async function GET() {
	const result = await health(async () => {
		await db()`SELECT 1`;
		return true;
	});
	return json(result, { status: result.ok ? 200 : 503 });
}
