# Discord Backup Hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optionally back up every new original image to a Discord webhook through a durable D1 job queue drained by the per-minute cron.

**Architecture:** `storeItem` adds a `backup_jobs` row in its existing insert batch when `DISCORD_BACKUP_WEBHOOK_URL` is set. `runScheduled` calls `drainBackupJobs`, which leases up to 5 due jobs, posts each original as multipart to the webhook, and settles the job by Discord's answer.

**Tech Stack:** SvelteKit on Cloudflare Workers, D1, R2, vitest with `@cloudflare/vitest-plugin`.

**Spec:** `docs/superpowers/specs/2026-11-25-discord-backup-design.md`

## Global Constraints
- Uploads never fail or wait on Discord; only the job insert joins the item batch.
- Webhook URL is never logged, stored in D1 or returned.
- Times are ms from `now()` (`src/lib/server/db.ts`).
- Defaults: max bytes 10 MiB (`10 * 1024 * 1024`), batch 5, lease 5 min, max attempts 8, backoff `min(2^attempts min, 60 min)`.
- Tests run from a scratch copy of the worktree (vitest breaks inside `.worktrees`).
- One commit at the end, body contains `Fixes #52`; no push.

## Review Focus
1. Webhook unset → no rows queued, drain makes no fetch (Task 1, Task 2 tests).
2. Duplicate upload → no second job (Task 1 test).
3. Two overlapping drains must not both settle one job → settle writes are `WHERE id = ? AND lease_token = ?` (Task 2 test: stale token update is a no-op).
4. Item deleted after queueing → job cascades away, drain sends nothing (Task 2 test).
5. Discord 429 `retry_after` is seconds (float) → `next_at = now + ceil(retry_after*1000)` (Task 2 test).

---

### Task 1: Queue table and enqueue in storeItem

**Files:**
- Create: `migrations/0004_backup_jobs.sql`
- Modify: `src/lib/server/env.ts` (add `DISCORD_BACKUP_WEBHOOK_URL?: string; DISCORD_BACKUP_MAX_BYTES?: string;` with doc comments)
- Modify: `src/lib/server/library.ts` (`storeItem` batch, ~line 283)
- Test: `tests/library.test.ts`

**Interfaces:**
- Produces: table `backup_jobs(id TEXT PK, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE, state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','leased','complete','skipped','failed')), attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, lease_token TEXT, lease_until INTEGER, message_id TEXT, error TEXT, created_at INTEGER NOT NULL)`, index `backup_jobs_state_next_idx (state, next_at)`.

- [ ] **Step 1: Failing tests** in `tests/library.test.ts`:
  - `queues a backup job when the Discord webhook is set`: `createItem({ ...unsignedEnv, DISCORD_BACKUP_WEBHOOK_URL: 'https://discord.test/hook' }, …)` → `SELECT state, attempts FROM backup_jobs WHERE item_id = ?` equals `{ state: 'pending', attempts: 0 }`; re-upload same input → `duplicate: true` and `COUNT(*)` for that item is 1.
  - `queues no backup job without a webhook`: `createItem(unsignedEnv, …)` → count 0.
  - `saveSharedCopy` with webhook set → one job for the copy.
- [ ] **Step 2:** Run from scratch copy: `npx vitest run tests/library.test.ts` → FAIL (no such table).
- [ ] **Step 3:** Write migration; in `storeItem` append `...(env.DISCORD_BACKUP_WEBHOOK_URL ? [enqueueBackupStatement(db, id)] : [])` to the batch, with `enqueueBackupStatement(db: D1Database, itemId: string)` beside `enqueueImageStatement` (`next_at = created_at = now()`).
- [ ] **Step 4:** Rerun → PASS.

### Task 2: Drain runner, cron wiring, README

**Files:**
- Create: `src/lib/server/backup.ts`
- Modify: `src/lib/server/cron.ts` (`runScheduled` awaits `drainBackupJobs(env)`)
- Modify: `README.md` (setup section)
- Test: `tests/backup.test.ts`

**Interfaces:**
- Consumes: `backup_jobs` (Task 1), `items` columns `storage_key, owner_id, content_hash, content_type, source_metadata`.
- Produces: `export async function drainBackupJobs(env: Env, fetcher: typeof fetch = fetch): Promise<void>`; returns immediately when the webhook is unset.

Claim (one statement, atomic):
```sql
UPDATE backup_jobs SET state = 'leased', lease_token = ?, lease_until = ?
WHERE id IN (SELECT id FROM backup_jobs
  WHERE (state = 'pending' AND next_at <= ?) OR (state = 'leased' AND lease_until <= ?)
  ORDER BY created_at LIMIT 5)
RETURNING *
```
Process claimed jobs in `created_at` order; each settle is `UPDATE … WHERE id = ? AND lease_token = ?`.

Settle rules (from spec):
| Case | Result |
|---|---|
| R2 original missing | `skipped`, error `original missing` |
| size > max | text-only notice post, `skipped` |
| 2xx | `complete`, `message_id` from JSON `id` (post with `?wait=true`) |
| 413 | text notice, `skipped` |
| 429 | `pending`, `next_at = now + ceil(retry_after*1000)`, attempts unchanged, stop run |
| other 4xx | `failed`, error = status + body truncated to 500 chars |
| 5xx / fetch throws | `attempts+1`, `next_at = now + min(2^attempts, 60) min`; `failed` at 8 |

Request: `FormData` with `payload_json` = `{ content, allowed_mentions: { parse: [] } }` and `files[0]` = original blob named `<item_id>.<ext>` (ext from content type). `content` lines: `item <id>`, `owner <owner_id>`, `sha256 <hash>`, `type <content_type>`, plus `source: <title> by <creator> (<license>)` when present; under 2000 chars.

- [ ] **Step 1: Failing tests** in `tests/backup.test.ts` (seed items with `createItem` + webhook env; pass a `vi.fn` fetcher returning `Response`s):
  - `posts the original and marks complete`: fetcher called once with URL `https://discord.test/hook?wait=true`, form `files[0]` bytes equal `png`, payload content contains item id and sha256, `allowed_mentions.parse` `[]`; job `complete`, `message_id` `'123'`.
  - `does nothing without a webhook`: fetcher not called.
  - `skips oversize originals with a notice`: `DISCORD_BACKUP_MAX_BYTES: '1'` → one call with no `files[0]`, job `skipped`.
  - `413 → skipped`; `404 → failed with status in error`.
  - `429 waits retry_after without an attempt and stops the run`: two jobs, response `{retry_after: 1.5}` → fetcher called once, first job `pending`, attempts 0, `next_at >= before + 1500`; second still `pending` untouched.
  - `5xx backs off then fails at 8`: after one run attempts 1, `next_at ≈ now + 120000`; set attempts 7 + due, run → `failed`.
  - `fetch throwing counts as an attempt`.
  - `reclaims an expired lease`: set row `leased`, `lease_until` past → sent; with future `lease_until` → not sent.
  - `stale lease token cannot settle`: covered by asserting settle SQL affects 0 rows when token changed mid-send (fetcher mutates `lease_token` before responding) → state stays `leased`.
  - `deleted item sends nothing`: delete item row → fetcher not called.
  - `claims at most 5 per run`.
- [ ] **Step 2:** Run `npx vitest run tests/backup.test.ts` (scratch copy) → FAIL (module missing).
- [ ] **Step 3:** Implement `drainBackupJobs` in `src/lib/server/backup.ts`; wire `runScheduled`.
- [ ] **Step 4:** Rerun → PASS.
- [ ] **Step 5:** README setup section: enable (`npx wrangler secret put DISCORD_BACKUP_WEBHOOK_URL`, apply migrations first), optional `DISCORD_BACKUP_MAX_BYTES`, privacy warning (private images go to Discord), backfill SQL:
  ```sql
  INSERT INTO backup_jobs (id, item_id, next_at, created_at)
  SELECT lower(hex(randomblob(16))), id, unixepoch() * 1000, created_at FROM items i
  WHERE NOT EXISTS (SELECT 1 FROM backup_jobs b WHERE b.item_id = i.id);
  ```
  requeue SQL: `UPDATE backup_jobs SET state = 'pending', attempts = 0, next_at = 0 WHERE state = 'failed';`

### Task 3: Verify and commit

- [ ] `npm run check` → 0 errors; `npm run build` → success; full `npm test` from scratch copy → all pass.
- [ ] Show summary, get author approval, then one commit (`feat: optional Discord backup of new originals`, body `Fixes #52`, Co-Authored-By line). Spec, plan, migration, code, tests, README in it; never `TASK.md` or `prototypes/`.
