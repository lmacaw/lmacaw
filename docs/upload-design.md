# Upload system design

How an image gets from the user's device into Lmacaw: R2 for bytes, D1 for rows, an AI job for analysis. Written against commit `6feda2d` on `orch/upload-design`. Every claim cites `file:line`; **[unverified]** marks anything not proven by this repo's code.

## 1. Components

| Piece | Role | Where |
|---|---|---|
| Browser (SvelteKit page) | Stage, hash, thumbnail, upload pool, toast | `src/routes/+page.svelte:150-231`, `src/lib/upload.ts`, `src/lib/thumbnail.ts` |
| `POST /api/v1/items` | Auth, size gate, form parse, validation, create | `src/routes/api/v1/items/+server.ts:36-110` |
| `GET /api/v1/fetch` | Server-side image proxy for URLs and Openverse | `src/routes/api/v1/fetch/+server.ts:8-32`, `src/lib/server/fetch-image.ts` |
| `createItem` / `storeItem` | Validate, dedup, write R2, insert D1 | `src/lib/server/library.ts:253-338` |
| R2 bucket `MEDIA` | Original + thumbnail objects | `wrangler.jsonc` (`r2_buckets`), `src/lib/server/storage.ts` |
| D1 `DB` | `items`, `ai_jobs`, `item_search`, `media_deletions` | `migrations/0001_init.sql:35-123` |
| `GET /api/v1/items/:id/media` | Serve via presigned R2 URL or Worker stream | `src/routes/api/v1/items/[id]/media/+server.ts:11-43` |

## 2. End-to-end flow

1. **Stage.** Files filtered to `image/*` by declared type (`+page.svelte:154`). Each is SHA-256 hashed once and deduped within the batch (`+page.svelte:159-164`). URL imports go through the proxy one at a time, one retry each, max 50 (`+page.svelte:178-196`).
2. **Commit to upload.** "Add N" closes the dialog and hands the queue to `eachLimit(queue, 3, …)` (`+page.svelte:200-210`, `upload.ts:23-27`). Collection target captured at click time (`+page.svelte:146,201`).
3. **Per file, in browser.** `prepareUpload` decodes with `createImageBitmap` (EXIF orientation applied), makes a ≤768 px thumbnail, WebP 0.8 → JPEG fallback, steps quality 0.7/0.6 to fit 300 KB, else throws (`thumbnail.ts:11-45,52-64`). Staged hash reused, not recomputed (`thumbnail.ts:62`, `upload.ts:4`).
4. **Request.** Multipart `file`, `thumbnail`, `sha256`, `width`, `height`, optional `collection`/`openverse` (`upload.ts:5-13`).
5. **Server gate.** Origin check → role `member` → `Content-Length` required, numeric, ≤ 21 MB + 300 KB (`items/+server.ts:10,39-46`). `request.formData()` (`:50`). Field presence (`:55-66`). Collection must exist and be the caller's — checked **before** any write (`:68-76`). Openverse metadata fetched server-side, not trusted from client (`:78-92`).
6. **Validate** (`library.ts:305-326`): original ≤ 20 MB; hash `^[a-f0-9]{64}$`; dims integer 1..20000; original type sniffed from magic bytes (JPEG/PNG/GIF/WebP only, `media-validation.ts:1-9`); thumbnail ≤ 300 KB, WebP/JPEG only, and its encoded dimensions parsed and required ≤ 768 (`library.ts:195-232,318-326`).
7. **Dedup.** `(owner_id, content_hash)` lookup; hit returns existing row, backfilling Openverse metadata if missing (`library.ts:181-193,264-265`).
8. **Write R2.** Two fresh random 256-bit keys (`storage.ts:6-9`, `library.ts:268-269`). Original and thumbnail `put` in parallel with `allSettled`, streamed through `FixedLengthStream` so R2 gets a known length (`library.ts:331-336`, `storage.ts:15-32`).
9. **Write D1.** One `db.batch`: insert `items`, enqueue `ai_jobs` (kind `image`, state `pending`), rebuild FTS row (`library.ts:280-290,165-168`, `search.ts:16-40`).
10. **Collection.** If set, `addToCollection` — also for duplicates (`items/+server.ts:99-100`).
11. **Respond.** `201` new / `200` duplicate, with DTO (`items/+server.ts:101-105`).
12. **Finish in browser.** Counts added/duplicate/failed; **one** `refresh()` after the whole queue (`+page.svelte:214-224,147-149`). Failed entries kept for a toast Retry that re-stages them (`+page.svelte:223-231,497`). `beforeunload` prompt while `uploading > 0` (`+page.svelte:397-398`).

## 3. R2 ↔ D1 consistency

No cross-store transaction. Ordering is **R2 first, D1 second**, so a row never points at a missing object on the happy path.

| Failure | Handling | Where |
|---|---|---|
| Either R2 put fails | Wait for both to settle, then delete both keys | `library.ts:270-277,330-336` |
| D1 batch throws, row absent | Delete both keys; re-check dedup (concurrent same-hash upload lost the `UNIQUE` race → return winner as duplicate) | `library.ts:292-301`, `0001_init.sql:52` |
| D1 batch throws, row present | Response lost after commit → treat as success, keep media | `library.ts:293-295` |
| D1 batch throws, re-check also fails | Can't rule out commit → keep media, rethrow (500) | `library.ts:294,296` |
| Delete item | Same batch queues keys in `media_deletions`, deletes FTS + row; then deletes R2 and dequeues each key | `library.ts:407-428,391-398` |

**Orphans (R2 objects without a row) can still occur:**
- `discard()` uses `allSettled` and ignores delete failures (`library.ts:270-271`) — a failed delete leaks silently; nothing records it.
- Worker eviction/timeout between R2 put and D1 commit leaves objects with no row and no record **[unverified: depends on runtime limits]**.
- The "can't rule out commit" path keeps media by design (`library.ts:296`); if the commit actually failed, both objects leak.

**Retries / sweeper gap:** `cleanupDeletedMedia` drains `media_deletions` (`library.ts:400-404`) but **nothing calls it** — the cron handler is a no-op (`cron.ts:3`, `entry.ts:8-10`; repo grep finds no other caller). So delete-time R2 failures stay queued forever. No sweeper exists for upload-time orphans either.

**Idempotency:** server dedup on `(owner_id, content_hash)` makes client retries safe — a retried upload that actually landed returns `200 duplicate` (`library.ts:264-265`, `+page.svelte:214`). Client does not auto-retry uploads; only manual Retry (`+page.svelte:226-231`).

## 4. Async AI pipeline

- **Enqueue:** atomic with the item insert (`library.ts:288`). Text edits enqueue a `document` job and drop pending/failed ones (`library.ts:357-365`).
- **Schema** supports leasing: `state ∈ pending|leased|complete|failed`, `lease_token`, `lease_until`, `attempts` (`0001_init.sql:82-96`). `ai_usage` table for neuron budget (`:98-102`).
- **Manual retry:** `POST /items/:id/retry-ai` resets the latest failed image job to `pending` (`retry-ai/+server.ts:7-17`, `library.ts:171-179`).
- **Consumer: not implemented.** Cron fires every minute (`wrangler.jsonc` `triggers.crons`) but `runScheduled` is empty (`cron.ts:3`). No code reads `ai_jobs` to lease, call `env.AI`, write `item_analysis`, or upsert Vectorize (repo grep: `env.AI`/`lease_token` have no consumer). Jobs accumulate as `pending`. `updateItem` notes Vectorize sync is deferred to "Milestone C" (`library.ts:369`).

## 5. Security and limits

| Concern | Control | Where |
|---|---|---|
| AuthN/Z | `requireRole('member')`; public mode = Access-JWT admin on `ADMIN_HOST`, password mode = session cookie | `items/+server.ts:40`, `request.ts:66-75`, `hooks.server.ts:6-20` |
| CSRF | `Origin` must match self or `ORIGIN` list (missing Origin allowed) | `request.ts:26-32`, `items/+server.ts:39` |
| Body size | `Content-Length` required (411), ≤ 21.3 MB (413) before parsing | `items/+server.ts:10,43-46` |
| Per-part size | Original ≤ 20 MB, thumbnail ≤ 300 KB | `library.ts:69-70,307,318` |
| Length spoofing | `FixedLengthStream` fails the put if bytes ≠ declared size | `storage.ts:23-30` |
| MIME | Client type ignored; magic-byte sniff decides `content_type`; unknown → 400 | `library.ts:315-316`, `media-validation.ts:1-9` |
| Thumbnail abuse | Type allowlist (WebP/JPEG) + parsed dims ≤ 768; JPEG scan bounded by 300 KB | `library.ts:318-326`, `media-validation.ts:11-14` |
| Collection IDOR | Ownership checked pre-write → 404 | `items/+server.ts:73-76` |
| Key safety | Random 64-hex keys, validated on every R2 op | `storage.ts:6-13` |
| Serving | Presigned GET, 10 min, forced `content-type`; fallback stream sets `nosniff` | `media-url.ts:16-28`, `media/+server.ts:28-42` |
| SSRF (fetch proxy) | http/https only, no userinfo, literal-host blocklist (loopback, RFC1918, CGNAT, link-local, multicast, ULA, mapped v6) re-checked on every manual redirect (max 4), 15 s timeout, 20 MB streaming cap, magic-byte sniff before returning | `fetch-image.ts:10-63,117-140,65-114` |

**Gaps / notes:**
- `sha256` is client-supplied and never verified server-side (`library.ts:308` checks format only). Effect is scoped to the caller's own library: a lying client can make a different image look like a duplicate of its own item. Low impact; costs one server-side hash to close.
- `width`/`height` are client-claimed; only range-checked (`library.ts:309-311`).
- No rate limit on uploads or `/fetch`; `allowAttempt` exists but is not used here (`request.ts:38-49`).
- SSRF blocklist is hostname-literal only; DNS names resolving to private IPs rely on Cloudflare egress not reaching private networks (`fetch-image.ts:59-61`) **[unverified platform guarantee]**.
- `/fetch` requires `member` (`fetch/+server.ts:11`), so it is not an open proxy.
- Decompression bombs: server never decodes pixels, so the risk lives only in the uploader's own browser.

## 6. Performance and cost choices

- **Client-side thumbnail** (`thumbnail.ts:11-45`): zero Worker CPU for image decode/resize; Workers have no native image codec without Images binding **[unverified cost comparison]**. Cost: server must validate an untrusted thumbnail (§5).
- **Hash once** at staging, reused at upload (`+page.svelte:160`, `upload.ts:4`, `thumbnail.ts:62`).
- **Concurrency 3** (`+page.svelte:210`): bounds browser memory (each in-flight file holds a decoded bitmap + canvas) and stays under the HTTP/1.1 6-connection cap, leaving room for UI fetches. Proven by `tests/upload-pool.test.ts:5-15`.
- **Parallel R2 puts** (`library.ts:331-334`): request latency ≈ max(original, thumb) not sum.
- **Single refresh** after the queue, not per file (`+page.svelte:220`): one list query (≤ 201 rows, `library.ts:68,157-160`) instead of N.
- **Single D1 batch** per create (`library.ts:280-290`): one round trip, atomic.
- **Presigned media URLs** (`media/+server.ts:28-31`): bytes served by R2, not proxied through the Worker; 302 cached 5 min.

## 7. Bottlenecks and 10× / 100×

Current shape: every original byte transits the Worker; body is fully parsed by `request.formData()` (`items/+server.ts:50`) **[unverified whether workerd buffers or spools multipart; assume buffered → up to ~21 MB in isolate memory per request]**.

| Bottleneck | 10× | 100× |
|---|---|---|
| Bytes through Worker (memory, request-size cap, CPU on multipart) | Fine; add upload rate limit via `allowAttempt` | **Presigned PUT direct to R2** (reuse `aws4fetch`, `media-url.ts`): `POST /uploads` → `{key, thumbKey, url, thumbUrl}`; client PUTs; `POST /items/commit` heads both objects, sniffs `headBytes` (`storage.ts:34-39`, already exists, unused), inserts row |
| AI jobs never processed (§4) | Implement cron consumer: lease N with `lease_until`, call AI, write `item_analysis`, mark complete | Move to **Cloudflare Queues** (enqueue in same request after commit; D1 row stays the source of truth) to decouple from 1-min cron tick and get retries/DLQ |
| Orphans / undeleted media | Call `cleanupDeletedMedia` from cron (one line in `cron.ts`) | Pending-upload table (`key, created_at`) written before put, cleared on commit; sweeper deletes stale keys. Or R2 lifecycle on a `tmp/` prefix + copy-on-commit |
| Large files / flaky mobile | Client size precheck (≤ 20 MB) to fail before upload | **Resumable uploads**: R2 multipart (or tus) with per-part retry |
| D1 single-writer | Fine | Batch is small; watch `item_search` FTS rebuild cost and `ai_jobs` index growth; archive completed jobs |
| Client hash/thumbnail on main thread | Fine | Move `prepareUpload` to a Worker (OffscreenCanvas path already exists, `thumbnail.ts:13-15`) |

## 8. Known trade-offs and open issues

1. **AI consumer missing** — jobs enqueue but never run (`cron.ts:3`). Highest-impact gap.
2. **`cleanupDeletedMedia` never called** — delete-time R2 failures never retried (`library.ts:400`).
3. **Silent orphan leaks** on failed `discard()` and on Worker death mid-create (`library.ts:270-277`).
4. **Unverified client hash** — dedup trusts the client (`library.ts:308`).
5. **No upload/fetch rate limit** (`items/+server.ts`, `fetch/+server.ts`).
6. **Tab close loses the queue** — only a `beforeunload` prompt (`+page.svelte:397-398`); nothing persisted.
7. **No client-side size or type precheck** beyond `image/*`: HEIC or >20 MB files fail only after upload/decode (`+page.svelte:154`, `library.ts:307,316`).
8. **Collection captured at click** — switching views mid-upload still targets the original collection (intended; `+page.svelte:201`).
9. **Collection deleted mid-upload** — ownership checked before the write, but `addToCollection` runs after and throws when the collection is gone (`items/+server.ts:74,100`, `collections.ts:52-67`). Item is saved yet the request 500s; client counts it failed, and Retry hits the same throw on the duplicate path.
10. **Animated GIF thumbnails** are a single frame from `createImageBitmap` **[unverified browser behavior]**; original keeps animation.
