# One Dockerfile for the whole workspace. Build any service by passing SERVICE
# (its package.json "name") and the PORT it listens on:
#
#   docker build --build-arg SERVICE=users-service --build-arg PORT=4001 -t users .
#   docker run -p 4001:4001 users
#
# Xenosis services run from source with tsx — no build step. This produces a
# self-contained deployment for one service (its src + production deps) and runs
# it via the service's own `start` script (node --import tsx src/service.ts).

ARG NODE_VERSION=24-slim

# ── build stage: install the workspace, carve out one service ───────────────
FROM node:${NODE_VERSION} AS build
ARG SERVICE
WORKDIR /repo
RUN corepack enable

COPY . .
RUN pnpm install --frozen-lockfile || pnpm install

# Self-contained deploy: the service + only its dependencies, flattened.
# (No compile — tsx runs the TypeScript source at runtime.)
RUN pnpm --filter "${SERVICE}" deploy --prod --legacy /out

# ── runtime stage ──────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runtime
ARG PORT=4000
ENV NODE_ENV=production
ENV PORT=${PORT}
WORKDIR /app
RUN corepack enable

COPY --from=build /out ./

EXPOSE ${PORT}
# Runs the service's `start`: node --import tsx src/service.ts --config ./xenosis.config.json
CMD ["pnpm", "start"]
