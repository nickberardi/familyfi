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

FROM node:26-bookworm-slim AS deps-base
WORKDIR /app
# Prisma's install script picks the schema engine (`prisma migrate deploy` at start) by the
# OpenSSL it finds. Without the runner's OpenSSL here it fetches the 1.1 engine, and every start
# then downloads the 3.0 one from binaries.prisma.sh, so a start with no internet fails.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@10.15.1
# Only the manifest and lockfile: a schema change must not install every dependency again, nor
# change the layers an update downloads. Dependencies' own install scripts run in the stages
# below, for this architecture; this package's postinstall (prisma generate) does not, and the
# client comes from the stage above. The build stage copies the full package.json back over this one.
COPY package.json pnpm-lock.yaml ./
RUN npm pkg delete scripts.postinstall

# Everything the build needs, with the client generated from the schema.
FROM deps-base AS deps
RUN pnpm install --frozen-lockfile
COPY --from=prisma-client /prisma-client /tmp/prisma-client
RUN client="$(node -p "require('path').join(require.resolve('@prisma/client/package.json'), '../../../.prisma/client')")" \
  && mkdir -p "$client" && cp -r /tmp/prisma-client/. "$client" && rm -rf /tmp/prisma-client

# What the image runs beside the standalone build, which already carries every file the server
# loads (next, react, the Prisma client and the rest): only the Prisma CLI for `migrate deploy`
# and PGlite for the in-memory database (scripts/runtime). Each is pinned to the version the
# lockfile resolved. What the CLI pulls in but `migrate deploy` never loads goes too: `prisma
# dev`'s own PGlite and its companions, and TypeScript, which it reads only for `--version`; and
# pnpm's record of the install, which holds its time and which nothing at runtime reads.
FROM deps-base AS runtime-deps
RUN node -e 'const fs = require("fs"); const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")); \
    const lock = fs.readFileSync("pnpm-lock.yaml", "utf8"); \
    const locked = (name) => { const quoted = name.includes("@") ? `'"'"'${name}'"'"'` : name; \
      const at = lock.indexOf(`\n      ${quoted}:\n        specifier: `); \
      if (at < 0) throw new Error(`${name} is not in the lockfile`); \
      return lock.slice(at).match(/\n        version: ([^(\s]+)/)[1]; }; \
    const keep = ["prisma", "@electric-sql/pglite"]; \
    pkg.dependencies = Object.fromEntries(keep.map((name) => [name, locked(name)])); \
    delete pkg.devDependencies; fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2)); \
    console.log(pkg.dependencies);' \
  && pnpm install --prod --no-frozen-lockfile --prefer-offline \
  && pglite="$(readlink -f node_modules/@electric-sql/pglite)" \
  && for dir in node_modules/.pnpm/@electric-sql+pglite@*; do \
    case "$pglite" in "$PWD/$dir"/*) ;; *) rm -rf "$dir" ;; esac; \
  done \
  && rm -rf node_modules/.pnpm/@electric-sql+pglite-socket@* node_modules/.pnpm/@electric-sql+pglite-tools@* \
    node_modules/.pnpm/typescript@* \
  && find node_modules -xtype l -delete \
  && rm -f node_modules/.modules.yaml node_modules/.pnpm-workspace-state-v1.json

FROM deps AS build
COPY . .
# A release passes its tag's version (release.yml, scripts/release.sh), which the image then
# reports wherever it shows package.json's (src/lib/version.ts), even when main's package.json
# has not caught up yet. Other builds keep package.json's.
ARG APP_VERSION
RUN if [ -n "$APP_VERSION" ]; then npm pkg set "version=$APP_VERSION"; fi
# Not `pnpm build`, which generates the client again under emulation. The server's own trace
# carries the musl builds of sharp and argon2, which can never load on this Debian image.
RUN pnpm exec next build \
  && rm -rf .next/standalone/node_modules/.pnpm/@img+sharp-*linuxmusl* \
    .next/standalone/node_modules/.pnpm/@node-rs+argon2-*musl* \
  && find .next/standalone/node_modules -xtype l -delete

FROM node:26-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=7001
ENV HOSTNAME=0.0.0.0
# Prisma engines need OpenSSL present to pick the right binary (avoids openssl-1.1.x warn), and
# pg_dump is for the backup before an update and for export (scripts/runtime/pre-update-backup.sh,
# src/server/database-dump.ts), pg_restore and psql for restoring one (restore-database.sh). They
# must be the server's major version, PostgreSQL 18, which Debian bookworm does not ship, so they
# come from the PostgreSQL project's repository, its key hash-checked.
# The logs and backups apt and dpkg leave say when the image was built; without them the same
# packages make the same layer, and an update need not download it again.
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
  && rm -rf /var/log/apt/* /var/log/dpkg.log /var/log/alternatives.log /var/cache/debconf/*-old \
    /var/lib/dpkg/*-old /var/cache/ldconfig/aux-cache \
  && pg_dump --version
# cloudflared for Remote access. Pinned and hash-checked at build time; FamilyFi never
# downloads it at runtime. scripts/update-cloudflared.sh bumps the version and both hashes
# together, and .github/workflows/cloudflared.yml opens a PR with it twice a month.
ARG TARGETARCH
ARG CLOUDFLARED_VERSION=2026.10.1
ADD --chmod=755 https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-${TARGETARCH} /usr/local/bin/cloudflared
RUN case "${TARGETARCH}" in \
    amd64) sum=3bfc539f45d2620c71debb7a86be0efa737ed5ccbad9eb85c787116900e5c586 ;; \
    arm64) sum=2c65dfabf616c40efc7545d107d7a57ad5e21377e2964b7e88af19a238074a46 ;; \
    *) echo "no cloudflared hash for ${TARGETARCH}" >&2; exit 1 ;; \
  esac \
  && echo "${sum}  /usr/local/bin/cloudflared" | sha256sum -c - \
  && /usr/local/bin/cloudflared --version
# The app runs as familyfi and owns its files from the copy on: a `chown -R` afterwards would
# store every file a second time in a layer of its own.
RUN groupadd --system familyfi \
  && useradd --system --gid familyfi --home-dir /app familyfi \
  && chown familyfi:familyfi /app \
  && mkdir -p /var/lib/familyfi/data /var/lib/familyfi/updater \
  && chown -R familyfi:familyfi /var/lib/familyfi
COPY --from=runtime-deps --chown=familyfi:familyfi /app/node_modules ./node_modules
COPY --from=build --chown=familyfi:familyfi /app/package.json ./package.json
COPY --from=build --chown=familyfi:familyfi /app/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=familyfi:familyfi /app/prisma ./prisma
COPY --from=build --chown=familyfi:familyfi /app/scripts/runtime ./scripts/runtime
COPY --from=build --chown=familyfi:familyfi /app/.next/standalone ./
COPY --from=build --chown=familyfi:familyfi /app/.next/static ./.next/static
COPY --from=build --chown=familyfi:familyfi /app/public ./public
COPY --from=build --chown=familyfi:familyfi /app/openapi ./openapi
# Read from disk during sync, never imported into a route bundle (src/server/mac-vendor.ts).
COPY --from=build --chown=familyfi:familyfi /app/src/server/mac-registrants.sqlite ./src/server/mac-registrants.sqlite
COPY --from=build --chown=familyfi:familyfi /app/.env.example ./.env.example
COPY --chown=familyfi:familyfi --chmod=755 scripts/runtime/docker-entrypoint.sh /app/docker-entrypoint.sh
# Watchtower's pre-update hook (docker-compose.yml), the restore operators run (docs/operations.md)
# and the entrypoint's help when a migration fails, executable whatever the checkout's file modes.
COPY --chown=familyfi:familyfi --chmod=755 scripts/runtime/pre-update-backup.sh scripts/runtime/restore-database.sh \
  scripts/runtime/migration-failed.sh /app/scripts/runtime/
EXPOSE 7001
ENTRYPOINT ["/app/docker-entrypoint.sh"]
