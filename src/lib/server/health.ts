export async function health(checkDatabase: () => Promise<boolean>): Promise<{ ok: boolean }> {
	try {
		return { ok: await checkDatabase() };
	} catch {
		return { ok: false };
	}
}
