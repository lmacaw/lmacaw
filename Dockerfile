FROM oven/bun:1.4.4 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.4.4 AS production
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile && mkdir -p /data/media && chown -R bun:bun /app /data
COPY --from=build --chown=bun:bun /app/build ./build
COPY --from=build --chown=bun:bun /app/scripts ./scripts
COPY --from=build --chown=bun:bun /app/migrations ./migrations
COPY --from=build --chown=bun:bun /app/src/lib/server ./src/lib/server
COPY --from=build --chown=bun:bun /app/worker ./worker
USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD bun -e "const r = await fetch('http://127.0.0.1:3000/api/health'); process.exit(r.ok ? 0 : 1)"
# ORIGIN falls back to the URL Render assigns, so a Render deploy needs no manual ORIGIN.
CMD ["sh", "-c", "export ORIGIN=\"${ORIGIN:-$RENDER_EXTERNAL_URL}\" && bun run migrate && bun run cleanup-media && bun run start"]
