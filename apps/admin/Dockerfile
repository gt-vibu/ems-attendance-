# Builds and runs the @company/admin app (Express API + bundled React
# frontend) as a single container. Single-stage on purpose: apps/admin's
# server.ts reaches into packages/database via a relative import (not an
# installed workspace dependency), and esbuild inlines that at build time
# (--packages=external only excludes real node_modules packages) — so the
# simplest correct setup is to build and run from the same pnpm workspace
# context this already works in locally, rather than fighting pnpm's
# symlinked node_modules layout across a multi-stage copy.
FROM node:20-slim

WORKDIR /repo

RUN corepack enable

# Only the workspace files this app actually needs — not the other (empty)
# apps/* scaffolds or unrelated packages/*.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/database ./packages/database
COPY apps/admin ./apps/admin

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @company/admin build

WORKDIR /repo/apps/admin
ENV NODE_ENV=production
# All "which calendar day is this" logic (check-in/absent-marking day
# boundaries, the 11:00 auto-absent cutoff) runs off the Node process's local
# clock, since there's no per-tenant timezone column yet. Without this,
# containers default to UTC — on Render that silently moves every day
# boundary and the absent-marking cutoff by +5:30h relative to India, which
# is what actually caused the "checked in Monday, but the day boundary/cutoff
# didn't line up" pilot bug. Override at deploy time (docker run -e TZ=...,
# or the TZ env var in render.yaml/docker-compose.yml) if the company isn't
# in India.
ENV TZ=Asia/Kolkata
EXPOSE 3000

CMD ["node", "dist/server.cjs"]
