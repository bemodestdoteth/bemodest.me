FROM node:20-alpine AS base

# Install libc6-compat for turbo
RUN apk add --no-cache libc6-compat
RUN npm install pnpm turbo --global

FROM base AS builder
WORKDIR /app
COPY . .
# Prune the workspace to api and its dependencies
RUN turbo prune @bemodest/api --docker

FROM base AS installer
WORKDIR /app

# First install dependencies (cache layer)
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/full/.gitignore .gitignore
RUN pnpm install --frozen-lockfile

# Build the project and its dependencies
COPY --from=builder /app/out/full/ .
# Build all dependencies (packages/*) required by api
RUN turbo run build --filter=@bemodest/api...

FROM base AS runner
WORKDIR /app

# Copy the built application
# In a pnpm monorepo with hoist=false (default), we need the whole structure.
COPY --from=installer /app .

CMD ["node", "apps/api/src/server.js"]
