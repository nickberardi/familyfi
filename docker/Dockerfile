FROM node:26-bookworm-slim AS deps
WORKDIR /app
RUN npm install -g pnpm@10.15.1
COPY package.json pnpm-lock.yaml prisma.config.ts ./
COPY prisma ./prisma
COPY scripts/print-database-url.mjs ./scripts/print-database-url.mjs
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm prisma generate && pnpm build

FROM node:26-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=7001
ENV HOSTNAME=0.0.0.0
# Prisma engines need OpenSSL present to pick the right binary (avoids openssl-1.1.x warn).
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates gosu \
  && rm -rf /var/lib/apt/lists/*
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
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/openapi ./openapi
COPY --from=build /app/.env.example ./.env.example
COPY scripts/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh \
  && groupadd --system familyfi \
  && useradd --system --gid familyfi --home-dir /app familyfi \
  && mkdir -p /var/lib/familyfi/data \
  && chown -R familyfi:familyfi /app /var/lib/familyfi
EXPOSE 7001
ENTRYPOINT ["/app/docker-entrypoint.sh"]
