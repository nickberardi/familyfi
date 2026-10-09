# Prisma's schema parser is WebAssembly that QEMU computes wrongly, so an image built for
# another architecture under emulation (scripts/release.sh) gets its client generated on the
# builder's own. The generated client is JavaScript and WebAssembly, the same on every platform.
FROM --platform=$BUILDPLATFORM node:26-bookworm-slim AS prisma-client
WORKDIR /app
RUN npm install -g pnpm@10.15.1
COPY package.json pnpm-lock.yaml prisma.config.ts ./
COPY prisma ./prisma
COPY scripts/runtime/print-database-url.mjs scripts/runtime/mode.mjs ./scripts/runtime/
RUN pnpm install --frozen-lockfile \
  && cp -r "$(node -p "require('path').join(require.resolve('@prisma/client/package.json'), '../../../.prisma/client')")" /prisma-client

FROM node:26-bookworm-slim AS deps
WORKDIR /app
# Prisma's install script picks the schema engine (`prisma migrate deploy` at start) by the
# OpenSSL it finds. Without the runner's OpenSSL here it fetches the 1.1 engine, and every start
# then downloads the 3.0 one from binaries.prisma.sh, so a start with no internet fails.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@10.15.1
COPY package.json pnpm-lock.yaml prisma.config.ts ./
COPY prisma ./prisma
COPY scripts/runtime/print-database-url.mjs scripts/runtime/mode.mjs ./scripts/runtime/
# Dependencies' own install scripts run here, for this architecture; this package's
# postinstall (prisma generate) does not, and the client comes from the stage above. The
# build stage copies the full package.json back over this one.
RUN npm pkg delete scripts.postinstall && pnpm install --frozen-lockfile
COPY --from=prisma-client /prisma-client /tmp/prisma-client
RUN client="$(node -p "require('path').join(require.resolve('@prisma/client/package.json'), '../../../.prisma/client')")" \
  && mkdir -p "$client" && cp -r /tmp/prisma-client/. "$client" && rm -rf /tmp/prisma-client

FROM deps AS build
COPY . .
# A release passes its tag's version (release.yml, scripts/release.sh), which the image then
# reports wherever it shows package.json's (src/lib/version.ts), even when main's package.json
# has not caught up yet. Other builds keep package.json's.
ARG APP_VERSION
RUN if [ -n "$APP_VERSION" ]; then npm pkg set "version=$APP_VERSION"; fi
# Not `pnpm build`, which generates the client again under emulation.
RUN pnpm exec next build

FROM node:26-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=7001
ENV HOSTNAME=0.0.0.0
# Prisma engines need OpenSSL present to pick the right binary (avoids openssl-1.1.x warn), and
# pg_dump is for the backup before an update and for export (scripts/runtime/pre-update-backup.sh,
# src/server/database-dump.ts). It must be the server's major version, PostgreSQL 18, which Debian
# bookworm does not ship, so it comes from the PostgreSQL project's repository, its key hash-checked.
ADD https://www.postgresql.org/media/keys/ACCC4CF8.asc /etc/apt/keyrings/pgdg.asc
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates gosu \
  && echo "0144068502a1eddd2a0280ede10ef607d1ec592ce819940991203941564e8e76  /etc/apt/keyrings/pgdg.asc" | sha256sum -c - \
  && chmod 644 /etc/apt/keyrings/pgdg.asc \
  && echo "deb [signed-by=/etc/apt/keyrings/pgdg.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-18 \
  && rm -rf /var/lib/apt/lists/* \
  && pg_dump --version
# cloudflared for Remote access. Pinned and hash-checked at build time; FamilyFi never
# downloads it at runtime. Bump the version and both hashes together (hashes are in the
# release notes at github.com/cloudflare/cloudflared/releases).
ARG TARGETARCH
ARG CLOUDFLARED_VERSION=2026.9.1
ADD --chmod=755 https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-${TARGETARCH} /usr/local/bin/cloudflared
RUN case "${TARGETARCH}" in \
    amd64) sum=03f1f25d1cc93b9ad6c60569d44060bc4f17ed97075760ed8cfca4b12dcd68cc ;; \
    arm64) sum=3d97437c71848bd8df68041e12436b484a661d95073ea1937f01a845ce88faa3 ;; \
    *) echo "no cloudflared hash for ${TARGETARCH}" >&2; exit 1 ;; \
  esac \
  && echo "${sum}  /usr/local/bin/cloudflared" | sha256sum -c - \
  && /usr/local/bin/cloudflared --version
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts/runtime ./scripts/runtime
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/openapi ./openapi
# Read from disk during sync, never imported into a route bundle (src/server/mac-vendor.ts).
COPY --from=build /app/src/server/mac-registrants.sqlite ./src/server/mac-registrants.sqlite
COPY --from=build /app/.env.example ./.env.example
COPY scripts/runtime/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh /app/scripts/runtime/pre-update-backup.sh \
  && groupadd --system familyfi \
  && useradd --system --gid familyfi --home-dir /app familyfi \
  && mkdir -p /var/lib/familyfi/data \
  && chown -R familyfi:familyfi /app /var/lib/familyfi
EXPOSE 7001
ENTRYPOINT ["/app/docker-entrypoint.sh"]

# The hosted demo's image (.github/workflows/demo.yml builds this target). FAMILYFI_MODE=demo runs
# the UniFi mock, which reads the gateway fixtures from disk (src/server/unifi/dev-mock.ts); no
# other mode does, so only this image carries them.
FROM runner AS demo
COPY --from=build /app/tests/fixtures/unifi/*.json ./tests/fixtures/unifi/

# The default target, for releases and container.yml: no demo fixtures.
FROM runner
