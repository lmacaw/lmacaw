# Lmacaw

Lmacaw is a self-hosted library for collecting, finding, and sharing images and GIFs. It uses SvelteKit, Bun, PostgreSQL, and optional local AI. The application is licensed under AGPL-3.0.

## Self-host with Docker

Copy `.env.example` to `.env`. Set `POSTGRES_PASSWORD` to a long random alphanumeric value and set `ORIGIN` to the exact browser-facing origin. To also reach the app at other addresses, such as a LAN IP next to a public domain, list them comma-separated in `ORIGIN`; the first is the main address (for example `ORIGIN=https://lmacaw.example.com,http://192.168.1.20:3000`). The session cookie is `Secure` on HTTPS addresses only. The default Compose file listens on `127.0.0.1:3000`. Use a trusted HTTPS reverse proxy for remote access.

```sh
docker compose up --build -d
```

Create the first administrator once. Supply the values through your shell or a secret manager, and do not commit them or include them in shell history.

```sh
export ADMIN_EMAIL ADMIN_PASSWORD
docker compose exec -e ADMIN_EMAIL -e ADMIN_PASSWORD app bun run bootstrap-admin
unset ADMIN_EMAIL ADMIN_PASSWORD
```

To reset a forgotten password, type the values at the prompts and run the reset command. It also signs that account out everywhere.

```sh
read -r EMAIL; read -rs NEW_PASSWORD; export EMAIL NEW_PASSWORD
docker compose exec -e EMAIL -e NEW_PASSWORD app bun run reset-password
unset EMAIL NEW_PASSWORD
```

Open the configured origin, sign in, and use **Invite** to create a single-use link for another member. Invitation links expire after seven days. Share the link through a channel you trust.

PostgreSQL and image data use separate named volumes. Do not delete those volumes when upgrading. To use S3-compatible storage instead, set `MEDIA_STORAGE=s3` and configure the S3 variables shown in `.env.example`; create a private bucket before starting the application.

Release tags publish a private image, `ghcr.io/phucnht/lmacaw:<version>` (also `:<major>.<minor>` and `:latest`), for amd64 and arm64 through `.github/workflows/publish.yml`. Hosts that pull it need `docker login ghcr.io` with a token that has `read:packages`.

## Optional AI worker

Set a long, random `AI_WORKER_TOKEN` on the app and the worker. Install Bun and Ollama on the worker machine, then install the models and application dependencies:

```sh
ollama pull gemma3:4b
ollama pull nomic-embed-text-v2-moe
bun install --frozen-lockfile
```

On Arch Linux with an NVIDIA GPU, install `ollama-cuda` and run `sudo systemctl enable --now ollama`; on macOS, install Ollama with Homebrew or the app. Set `LMACAW_URL` to the app's HTTPS origin and set `AI_WORKER_TOKEN` to the same value as the server. HTTP is accepted only for localhost. Set `OLLAMA_URL`, `AI_VISION_MODEL`, or `AI_EMBEDDING_MODEL` to override the defaults, then run:

```sh
bun run worker
```

The worker polls the server for tasks; no inbound port on the worker is required. Images remain available when the worker is offline. Search uses existing tags, descriptions, and extracted text without the worker. Semantic search needs a connected worker and uses only matching embedding models. Generated metadata can be edited in the image detail.

Editing a description, tags, or image text queues a new search embedding for that item. If the item changes again before the worker finishes, the older result is discarded. After changing `AI_EMBEDDING_MODEL`, queue re-embedding on the server for items indexed with another model:

```sh
bun run reindex nomic-embed-text-v2-moe   # the new model name; omit it to re-embed every item
```

Until reindexing finishes, semantic search only matches items embedded with the worker's current model; keyword search still covers everything.

The default models are `gemma3:4b` (vision) and `nomic-embed-text-v2-moe` (search). Measured on 2026-11-08 with Ollama 0.40.15 and `scripts/benchmark-search.ts` (30 Openverse photos, 10 topics, 20 English and 20 Vietnamese queries, recall@5):

| Hardware | Vision model | 30 images | English | Vietnamese | Notes |
| --- | --- | --- | --- | --- | --- |
| RTX 3070 Ti 8 GB, EndeavourOS | `gemma3:4b` | 35 s | 20/20 | 20/20 | 5.5 GB VRAM with both models loaded |
| Apple M3 Pro 36 GB | `gemma3:4b` | 80 s | 20/20 | 18/20 | |
| Apple M3 Pro 36 GB | `qwen2.5vl:3b` | about 2 min | 20/20 | 17/20 | transcribes meme text most literally |
| RTX 3070 Ti 8 GB | `qwen2.5vl:3b` | — | — | — | 3 of 30 photos fail: the CUDA build degenerates (`token repeat limit reached`); not recommended on NVIDIA |

Uncached searches take about 2 seconds. `gemma3:4b` tends to normalise slang when transcribing (for example `i wuvs my teddy` becomes `i love my teddy`); owners can correct the text, or set `AI_VISION_MODEL=qwen2.5vl:3b` on Apple Silicon. `qwen3-vl:4b` spent its whole output budget reasoning and returned no answer. Ollama may place a model on the CPU if other models hold GPU memory when it loads; check `ollama ps` shows `100% GPU`.

Reproduce against a disposable server, database, and running worker with `BENCH_URL`, `BENCH_EMAIL`, and `BENCH_PASSWORD` set: `bun run scripts/benchmark-search.ts`. It saves 3 Openverse images for each of 10 topics; results vary with Openverse content. Thirty photos is a small sample, not a quality guarantee. The worker only needs outbound access: to run it on another machine against a local test server, forward the port over SSH (`ssh -R 5199:127.0.0.1:5199 gpu-host`) and set `LMACAW_URL=http://127.0.0.1:5199` there. GIF analysis uses the first frame. Copying a GIF through the browser copies a still frame; download retains the original animation.

## Discover

Discover searches [Openverse](https://openverse.org) anonymously (20 results per page, the anonymous limit). Openverse indexes general openly licensed images, so results may contain few memes. Saved items keep the source page, creator, license, and attribution, shown in the item detail; verify license terms at the original source.

## Render

`render.yaml` is a Render Blueprint: a Docker web service (`starter`) deployed from `main`, and a PostgreSQL 17 database (`basic-256mb`, no public access) in Singapore. Change plans or region in the file before creating it. Render's filesystem is temporary, so media goes to S3-compatible storage; Cloudflare R2 works:

1. In Cloudflare, create a private R2 bucket and an R2 API token with **Object Read & Write** on that bucket only. Note the bucket name, access key ID, secret, and the S3 endpoint `https://<account-id>.r2.cloudflarestorage.com`.
2. In Render, choose **New → Blueprint**, connect `phucnht/lmacaw`, and enter `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY` when prompted. `AI_WORKER_TOKEN` is generated; copy it from the service's environment for the worker.
3. The container runs migrations on start, and `ORIGIN` defaults to the URL Render assigns (`RENDER_EXTERNAL_URL`). Set `ORIGIN` yourself when you add a custom domain.
4. Create the administrator once from the service's **Shell**, typing the values at the prompts so the password stays out of shell history: `read -r ADMIN_EMAIL; read -rs ADMIN_PASSWORD; export ADMIN_EMAIL ADMIN_PASSWORD; bun run bootstrap-admin`.

Render's proxy appends to `X-Forwarded-For` without removing values a client sends, so the app does not trust that header. Sign-in rate limiting therefore applies to the proxy address and is shared by all members (10 attempts per minute). Do not set `ADDRESS_HEADER` unless you put a proxy that overwrites the header in front of Render.

## Backup and restore

Stop the application and AI worker while taking a consistent backup of both PostgreSQL and media. For filesystem storage, with the default Compose service names:

```sh
docker compose stop app
docker compose exec -T db pg_dump -U lmacaw -Fc lmacaw > lmacaw-db.dump
docker cp "$(docker compose ps -aq app):/data/media" ./lmacaw-media
docker compose start app
```

Store both backups securely. Restore into a **new, empty** Compose project with matching application and PostgreSQL versions. Start its database, create its app container, restore the database and files, then start the app:

```sh
docker compose up -d db
docker compose create app
docker compose exec -T db pg_restore --clean --if-exists --no-owner -U lmacaw -d lmacaw < lmacaw-db.dump
docker cp ./lmacaw-media/. "$(docker compose ps -aq app):/data/media/"
docker compose start app
docker compose exec -u root app chown -R bun:bun /data/media
```

Verify sign-in and image access before using the restored server. For S3 storage, back up and restore the bucket with the storage provider's tools instead of copying `/data/media`; retain the corresponding database backup from the same stopped-write window. Restore commands change the target database and media, so never point them at an existing library.

## Development and checks

Use Bun 1.4.4 or newer and a dedicated PostgreSQL database with pgvector. Earlier Bun versions can hand a pooled database connection that is still inside a transaction to an unrelated query, which can stall every other connection; `tests/db.test.ts` fails on them. Set `DATABASE_URL` and `MEDIA_ROOT`, then run `bun install --frozen-lockfile`, `bun run migrate`, `bun run bootstrap-admin`, and `bun run dev`.

Integration tests require a disposable database whose name ends in `_test`; set `TEST_DATABASE_URL` to that database and apply migrations before running `bun run test`. Set `TEST_S3_ENDPOINT` to run the S3 integration test. Browser tests require a separate database whose name ends in `_e2e_test`, a test administrator with email `admin@example.com` and password `a long admin password`, and Playwright's Chromium, Firefox, and WebKit (`bunx playwright install chromium firefox webkit`). Set `DATABASE_URL` and `MEDIA_ROOT` to test-only locations before running `bun run test:e2e`; add `--project=chromium` to run one engine. The browser tests remove that test administrator's items and collections. They include an axe accessibility audit of the main screens in light and dark themes at 375 px and desktop widths, which fails on serious or critical violations.

Browser limits found by the browser tests:

- Copying writes a PNG in Chromium, Firefox, and WebKit; an animated GIF copies its first frame. Firefox and Safari accept a clipboard write only if it starts inside the click, so the copy starts before the image has loaded. Where the browser has no clipboard image support, including Lmacaw served over plain HTTP on an address other than `localhost`, the interface replaces copy with download.
- Playwright can grant clipboard permissions only in Chromium (read and write) and WebKit (read). Firefox needs none for a write made inside a click.
- Firefox ignores the data in a script-made paste event, so the paste test copies an image and presses Ctrl or Cmd+V.
- Playwright cannot emulate a touch screen in Firefox, so the 44 px touch-target test runs in Chromium and WebKit only.

Run `bun run check` and `bun run build` for type and production-build checks. `bun run cleanup-media` retries storage deletions left pending by a temporary storage failure and removes stored objects that no library item references and that are older than 24 hours (for example, bytes from an upload whose database write failed). The container also runs it on startup. Never point it at a bucket or directory shared with other data.
