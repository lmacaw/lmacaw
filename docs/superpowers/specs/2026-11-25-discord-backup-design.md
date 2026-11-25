# Discord backup hook (#52)

## Intent
Disaster recovery: an off-site copy of every original image, so the library survives losing R2 or the Cloudflare account. Optional; off unless the instance admin sets a webhook.

## Goals
- Every new item's original file is posted to one Discord webhook, with enough text to map it back to the item.
- No backup is lost silently: each one ends `complete`, `skipped` (with a visible notice) or `failed` (queryable).
- Uploads never fail, slow down or change response because of the hook.

## Non-goals
- Restore tooling. Per-user webhooks or settings. Backing up edits, metadata changes or deletions. An admin UI for failed jobs.

## Anti-goals
- An upload that errors or waits on Discord.
- The webhook URL leaking (logs, responses, client bundles).
- A thumbnail sent in place of an original and counted as a backup.

## Approaches
1. Inline `ctx.waitUntil` after the response: smallest, but a 429 or outage loses the backup with no record. Rejected.
2. **D1 `backup_jobs` table drained by the existing per-minute cron. Picked**: durable, retries, honors 429, failures queryable.
3. Cloudflare Queues: built-in retries, but a new binding self-hosters must provision, nothing gained over 2. Rejected.

Validated with a logic prototype (state model below).

## Decided
- **Config**: `DISCORD_BACKUP_WEBHOOK_URL` Worker secret (optional, in `Env`). Unset = feature off, no jobs queued. `DISCORD_BACKUP_MAX_BYTES` var, default 10 MiB (raise for boosted servers).
- **Events**: every new item from `storeItem`: upload, Openverse save, shared copy. Duplicates (early return in `storeItem`) queue nothing.
- **Enqueue**: the job insert goes in `storeItem`'s existing `db.batch` with the item insert, only when the webhook is set. If the batch fails, no job; the upload path is otherwise unchanged.
- **Table** (`migrations/0003_backup_jobs.sql`): `backup_jobs(id PK, item_id REFERENCES items(id) ON DELETE CASCADE, state CHECK IN ('pending','leased','complete','skipped','failed') DEFAULT 'pending', attempts INT DEFAULT 0, next_at INT, lease_token, lease_until INT, message_id TEXT, error TEXT, created_at INT)`, index on `(state, next_at)`. Times in ms (`now()`).
- **Runner** (`runScheduled` → `drainBackupJobs(env)`; skip entirely when the webhook is unset): claim up to 5 jobs that are `pending` and due, or `leased` with an expired lease, oldest first; lease 5 min with a random token. Send one at a time:
  - original size > max → post a text-only notice, state `skipped`.
  - item's original missing in R2 → `skipped`, error noted.
  - 2xx → `complete`, store Discord `message_id` (post with `?wait=true`).
  - 429 → back to `pending`, `next_at = now + retry_after`, attempts unchanged, stop this run.
  - 413 → post the text notice, `skipped` (max set above the server's real limit). *(builder's call)*
  - other 4xx (bad or deleted webhook) → `failed` at once; retrying cannot help, requeue SQL recovers. *(builder's call)*
  - 5xx / network → `attempts + 1`, `next_at = now + min(2^attempts min, 60 min)`; at 8 attempts → `failed`.
  - Every state write is conditioned on the lease token.
- **Message**: multipart `payload_json` + `files[0]` (original bytes, filename `<item_id>.<ext>`). Content: item id, owner id, sha256, content type, and source title/creator/license when present. No mentions (`allowed_mentions: {parse: []}`).
- **Crash**: an expired lease is reclaimed; a duplicate Discord post is acceptable.
- **Privacy**: README states private images are sent to Discord when enabled, the URL is a secret (`wrangler secret put`), and how to requeue failed jobs with SQL.
- **Existing items**: no automatic backfill. README gives one copy-paste SQL that queues a job for every item without one, run once after enabling (~300 items/hour).
- **Migration order**: the job insert shares the item batch, so migration 0003 must be applied before setting the secret; README deploy steps already run `d1 migrations apply` first, and the setup section says so. *(builder's call)*
- **Errors**: Discord error bodies are stored truncated; the webhook URL is never logged or stored.

## Future (not built)
One Discord thread per image, using the stored `message_id`.

## Left to the builder
Module name and layout (e.g. `src/lib/server/backup.ts`), test shape (mock `fetch`, follow `tests/library.test.ts` patterns), exact notice wording.
