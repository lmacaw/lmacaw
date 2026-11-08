# Lmacaw

Lmacaw is a self-hosted library for collecting, finding, and sharing images and GIFs. It uses SvelteKit, Bun, PostgreSQL, and optional local AI. The application is licensed under AGPL-3.0.

## Self-host with Docker

Copy `.env.example` to `.env`. Set `POSTGRES_PASSWORD` to a long random alphanumeric value and set `ORIGIN` to the exact browser-facing origin. The default Compose file listens on `127.0.0.1:3000`. Use a trusted HTTPS reverse proxy for remote access.

```sh
docker compose up --build -d
```

Create the first administrator once. Supply the values through your shell or a secret manager, and do not commit them or include them in shell history.

```sh
export ADMIN_EMAIL ADMIN_PASSWORD
docker compose exec -e ADMIN_EMAIL -e ADMIN_PASSWORD app bun run bootstrap-admin
unset ADMIN_EMAIL ADMIN_PASSWORD
```

Open the configured origin, sign in, and use **Invite** to create a single-use link for another member. Invitation links expire after seven days. Share the link through a channel you trust.

PostgreSQL and image data use separate named volumes. Do not delete those volumes when upgrading. To use S3-compatible storage instead, set `MEDIA_STORAGE=s3` and configure the S3 variables shown in `.env.example`; create a private bucket before starting the application.

## Optional AI worker

Set a long, random `AI_WORKER_TOKEN` on the app and the worker. Install Bun and Ollama on the worker machine, then install the models and application dependencies:

```sh
ollama pull qwen2.5vl:3b
ollama pull nomic-embed-text-v2-moe
bun install --frozen-lockfile
```

Set `LMACAW_URL` to the app's HTTPS origin and set `AI_WORKER_TOKEN` to the same value as the server. HTTP is accepted only for localhost. Set `OLLAMA_URL`, `AI_VISION_MODEL`, or `AI_EMBEDDING_MODEL` to override the defaults, then run:

```sh
bun run worker
```

The worker polls the server for tasks; no inbound port on the worker is required. Images remain available when the worker is offline. Search uses existing tags, descriptions, and extracted text without the worker. Semantic search needs a connected worker and uses only matching embedding models. Generated metadata can be edited in the image detail.

Editing a description, tags, or image text queues a new search embedding for that item. If the item changes again before the worker finishes, the older result is discarded. After changing `AI_EMBEDDING_MODEL`, queue re-embedding on the server for items indexed with another model:

```sh
bun run reindex nomic-embed-text-v2-moe   # the new model name; omit it to re-embed every item
```

Until reindexing finishes, semantic search only matches items embedded with the worker's current model; keyword search still covers everything.

The default models are starting points. Measured on 2026-11-08 on an Apple M3 Pro (36 GB) with Ollama and the default models: about 11 seconds per image for description, text extraction, and tags; about 2 seconds per uncached search query; an edited description was searchable about 3 seconds after saving. A small English/Vietnamese check found cross-language matches (for example, `con mèo ôm gấu bông` returned a cat-with-teddy-bear meme), but this is not a quality benchmark. NVIDIA hardware has not been tested. GIF analysis uses the first frame. Copying a GIF through the browser copies a still frame; download retains the original animation.

## Discover

Discover searches [Openverse](https://openverse.org) anonymously (20 results per page, the anonymous limit). Openverse indexes general openly licensed images, so results may contain few memes. Saved items keep the source page, creator, license, and attribution, shown in the item detail; verify license terms at the original source.

## Render

Deploy the application repository as a Docker web service. Configure a persistent PostgreSQL database with the `vector` extension, private S3-compatible storage, `DATABASE_URL`, `MEDIA_STORAGE=s3`, the S3 variables, `ORIGIN` as the public HTTPS origin, and `BODY_SIZE_LIMIT=23068672`. Optionally set `AI_WORKER_TOKEN`.

The container runs migrations before starting. Create the administrator with the bootstrap command in a secure one-off environment connected to the same database. Render's default filesystem is temporary, so do not use it for uploaded media. If a trusted reverse proxy terminates TLS, configure the adapter's origin and client-address headers for that proxy; do not trust arbitrary client-supplied forwarded headers. Per-client rate limiting depends on obtaining the correct client address.

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

Use Bun 1.3.11 or newer and a dedicated PostgreSQL database with pgvector. Set `DATABASE_URL` and `MEDIA_ROOT`, then run `bun install --frozen-lockfile`, `bun run migrate`, `bun run bootstrap-admin`, and `bun run dev`.

Integration tests require a disposable database whose name ends in `_test`; set `TEST_DATABASE_URL` to that database and apply migrations before running `bun run test`. Set `TEST_S3_ENDPOINT` to run the S3 integration test. Browser tests require a separate database whose name ends in `_e2e_test`, a test administrator with email `admin@example.com` and password `a long admin password`, and Playwright Chromium. Set `DATABASE_URL` and `MEDIA_ROOT` to test-only locations before running `bun run test:e2e`. The browser tests remove that test administrator's items and collections.

Run `bun run check` and `bun run build` for type and production-build checks. `bun run cleanup-media` retries storage deletions left pending by a temporary storage failure and removes stored objects that no library item references and that are older than 24 hours (for example, bytes from an upload whose database write failed). The container also runs it on startup. Never point it at a bucket or directory shared with other data.
