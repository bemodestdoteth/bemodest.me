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
COPY .gitignore .gitignore
COPY --from=builder /app/out/json/ .
RUN pnpm install --frozen-lockfile

# Build the project and its dependencies
COPY --from=builder /app/out/full/ .
# Build all dependencies (packages/*) required by api
RUN turbo run build --filter=@bemodest/api...

# Expose the API port
ARG PORT
ENV PORT=${PORT}
EXPOSE ${PORT}

ARG UID
ARG GID

FROM base AS runner
WORKDIR /app

# Accept UID/GID from build args
ARG UID
ARG GID
ARG PORT
ENV PORT=${PORT}

# Don't run production as root
RUN addgroup --system --gid ${GID} expressjs || true
RUN adduser --system --uid ${UID} --ingroup expressjs expressjs || true
USER expressjs

# Copy the built application
# In a pnpm monorepo with hoist=false (default), we need the whole structure.
COPY --from=installer --chown=${UID}:${GID} /app .

CMD ["node", "apps/api/src/server.js"]
