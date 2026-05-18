# CLAUDE.md

## Environment
- pnpm monorepo (see `pnpm-workspace.yaml`, `turbo.json`)
- Node.js apps: `node` / `pnpm` only (never `npm` / `yarn`)
- API: `node --env-file=.env src/server.js`
- Sidecar: `cargo run` / `cargo build --release`
- Build package before depending: `pnpm --filter <pkg> build`

## Code style — respect existing patterns
When editing an existing file, read at least one neighboring function and match its patterns exactly (imports, error handling, naming). Do not introduce new conventions unless the file is empty or you are explicitly refactoring.

## Libraries (ALWAYS USE — do not reimplement)
`@bemodest/utils`, `@bemodest/database`, `@bemodest/config`, `@bemodest/types`

### Imports (exact)
```typescript
import { logger, createLogger } from '@bemodest/utils';
import { MongoDBClient, RedisClient, GenericRepository } from '@bemodest/database';
import { validateApiConfig, validateWebConfig } from '@bemodest/config';
import { SystemConfigSchema } from '@bemodest/types';
```

### Why
These wrappers handle Winston formatting, MongoDB/Redis connection pooling, Zod env validation, and CAIP-2 abstractions. Custom implementations bypass all of that.

## Workspace conventions
- Use workspace dependencies: `@bemodest/<pkg>` instead of external duplicates. New API routes: use `modules/<domain>/` not `routes/api.js`.

## Databases
- MongoDB: via `MongoDBClient` in `@bemodest/database` (see `.env.example` for collections)
- Redis: via `RedisClient` in `@bemodest/database`

## Test contract
- Only `@bemodest/utils` has `vitest`. No root test runner, no pre-commit hooks, no CI.

## Git
- Never use `git commit --no-verify`

## Hallucination prevention rules
- If you do not have a tool result for a fact, say "I need to fetch this" — DO NOT invent values
- Schema field names are case-sensitive — copy exactly from the tool response
- Before answering questions or making changes in an area with reference material, check `/mnt/870-evo-1/server-dev/bemodest.me/docs/references` and follow any matching reference doc.
- If a reference doc conflicts with current code or tool results, trust the current verified result and state the conflict instead of guessing.

## Dependencies
When implementing features that use external libraries, use the **Context7 MCP server** to fetch current documentation.

## Code search policy
For structural pattern search, use ast-grep. For semantic similarity search, use sourcerer. Do not fall back to Read or Grep for codebase exploration.