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
EXPOSE 3000

CMD ["node", "dist/server.cjs"]
