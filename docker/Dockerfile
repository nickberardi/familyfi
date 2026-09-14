FROM node:26-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm prisma generate && pnpm build

FROM node:26-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/openapi ./openapi
COPY --from=build /app/.env.example ./.env.example
COPY scripts/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh && groupadd --system familyfi && useradd --system --gid familyfi familyfi && chown -R familyfi:familyfi /app
USER familyfi
EXPOSE 3000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
