// Queue search re-embedding after changing AI_EMBEDDING_MODEL on the worker.
// Usage: bun run reindex [model]   (no model: re-embed every analysed item)
import { db } from '../src/lib/server/db';
import { enqueueReindex } from '../src/lib/server/ai';

const sql = db();
try { console.log(`Queued ${await enqueueReindex(sql, process.argv[2] ?? null)} item(s) for re-embedding.`); }
finally { await sql.close(); }
