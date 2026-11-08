import { db } from '../src/lib/server/db';
import { cleanupDeletedMedia, reconcileOrphans } from '../src/lib/server/library';
import { storageFromEnv } from '../src/lib/server/storage';

const sql = db();
try {
	const storage = storageFromEnv();
	await cleanupDeletedMedia(sql, storage);
	const removed = await reconcileOrphans(sql, storage);
	console.log(`Removed ${removed.length} unreferenced media object(s).`);
}
finally { await sql.close(); }
