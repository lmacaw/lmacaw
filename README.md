# Lmacaw

Lmacaw is a library for collecting, finding, and sharing images and GIFs. It runs on Cloudflare
Workers with SvelteKit, D1, R2, Vectorize, and Workers AI. The application is licensed under
AGPL-3.0.

The public instance is [lmacaw.meme](https://lmacaw.meme): a read-only meme library. Visitors browse,
search, copy, and download without an account. The maintainers manage content on
`admin.lmacaw.meme`, which Cloudflare Access protects.

## Auth modes

`AUTH_MODE` picks the model:

- `public` (lmacaw.meme): visitors are anonymous and read only the shared library. A request is an
  admin only when it arrives on `ADMIN_HOST` with a valid Cloudflare Access token for
  `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`. There is no sign-up, sign-in, or mail.
- `password` (the default): members sign in with email and password. The first visit shows a setup
  page that creates the administrator, and only while there are no users. Email links work only when
  `RESEND_API_KEY` is set.

## Development

Use Bun 1.4.4 or newer.

```sh
bun install --frozen-lockfile
cp .dev.vars.example .dev.vars
bun run db:migrate:local
bun run build && bun run preview
```

Open <http://localhost:4173>. `.dev.vars.example` runs password mode with fake AI, so no Cloudflare
account is needed locally.

Run `bun run check` and `bun run test` before asking for review; CI runs the same checks and the
build. Tests run inside workerd through `@cloudflare/vitest-plugin`.

## Deploy

`wrangler.jsonc` describes the production Worker: the `lmacaw.meme` and `admin.lmacaw.meme` custom
domains, the bindings, and the public-mode variables. Deploy from an up-to-date `develop`:

```sh
npx wrangler d1 migrations apply lmacaw --remote
bun run build
npx wrangler deploy
```

R2 presigned URLs are optional. Without `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, and
`R2_SECRET_ACCESS_KEY` secrets, media streams through the Worker.

### Discord backup (optional)

An off-site copy of every new original, posted to one Discord webhook by the per-minute cron
(about 300 images an hour). It is off unless the secret is set. **Every image is sent, private ones
included**, so use a private channel. Apply migrations first: the backup job is written in the same
batch as the new item.

```sh
npx wrangler d1 migrations apply lmacaw --remote
npx wrangler secret put DISCORD_BACKUP_WEBHOOK_URL
```

Originals over `DISCORD_BACKUP_MAX_BYTES` (default 10 MiB, Discord's limit without boosts) get a
text notice instead of the file. Items that existed before enabling are not backed up; queue them
once with:

```sh
npx wrangler d1 execute lmacaw --remote --command "INSERT INTO backup_jobs (id, item_id, next_at, created_at) SELECT lower(hex(randomblob(16))), id, unixepoch() * 1000, created_at FROM items i WHERE NOT EXISTS (SELECT 1 FROM backup_jobs b WHERE b.item_id = i.id)"
```

Failed jobs (for example after a deleted webhook) stay in `backup_jobs` with their error. Requeue
them with `UPDATE backup_jobs SET state = 'pending', attempts = 0, next_at = 0 WHERE state = 'failed'`.

## Self-hosting

Docker self-hosting is paused while it is rebuilt on this codebase, with SQLite and filesystem or S3
storage in place of D1 and R2.

The previous app, with PostgreSQL, Docker Compose, and the Ollama AI worker, is kept on the
`legacy/postgres` branch and the `postgres-final` tag. Use them for an existing Docker install until self-hosting returns.
