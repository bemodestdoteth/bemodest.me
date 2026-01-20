## Category 0: Code Reuse & Retrieval (C-Series)
C-0001: MUST retrieve existing components/utilities via semantic search before creating new ones (reuse_ratio ≥0.85)
C-0002: Shared utilities MUST be placed in packages/ workspace, not duplicated across apps
C-0003: Test structure MUST be reused (modify only assertions/mocks, never scaffolding)
C-0004: Before creating function, MUST check existing codebase via semantic search to prevent duplication

## Category 1: Environment & Execution (E-Series)
E-1001: Node version MUST be ≥20.0.0 LTS (verify via process.version)
E-1002: All file paths MUST start with /mnt/870-evo-1/server-dev/Javascript/bemodest.me/
E-1003: Package manager MUST be pnpm (never npm or yarn)
E-1004: Child processes MUST use execa with timeout (default: 30s IO, 90s compute, 120s network) [ref: moldstud.com/articles/p-best-practices-for-building-robust-apis-with-nodejs-ultimate-guide]
E-1005: Async operations MUST use AbortController for timeout management [ref: betterstack.com/community/guides/scaling-nodejs/nodejs-timeouts]
E-1006: Use absolute imports from @/ alias (configured in tsconfig paths)
E-1007: All shell commands MUST use execa with {timeout, reject: true, cleanup: true}

## Category 2: Code Quality & Completeness (Q-Series)
Q-2001: All functions MUST have TypeScript type annotations for parameters and return types with strict mode enabled [ref: betterstack.com/community/guides/scaling-nodejs/typescript-strict-option]
Q-2002: All public functions MUST have JSDoc with @param, @returns, @throws, and @example
Q-2003: Function cyclomatic complexity MUST be ≤10 (verify with eslint complexity rule)
Q-2004: Line length MUST be ≤120 characters (enforced by Prettier)
Q-2005: Import order: node builtins → external packages → @/ aliases → relative imports (enforced by eslint-plugin-import)
Q-2006: String literals appearing ≥3 times OR ≥2 times with length ≥15 chars MUST be constants (excludes log messages <15 chars)
Q-2007: Numeric literals except 0, 1, -1 MUST be named constants (enforced by @typescript-eslint/no-magic-numbers)
Q-2008: Function names MUST be verb-noun pairs from approved verbs: [create, fetch, update, delete, validate, parse, transform, handle, process, execute]
Q-2009: Single-line wrapper functions REQUIRE explicit justification in JSDoc (e.g., "Adapter for legacy API compatibility")

## Category 3: Security & Configuration (S-Series)
S-3001: All configuration (API keys, DB credentials) MUST load from environment variables via validated config module [ref: moldstud.com/articles/p-best-practices-for-building-robust-apis-with-nodejs-ultimate-guide]
S-3002: Database passwords MUST be URL-encoded via encodeURIComponent()
S-3003: All secrets MUST have .env.example entries with placeholder values
S-3004: File operations MUST use node:path and node:fs/promises (never sync methods in routes/middleware)
S-3005: NEVER use eval(), Function() constructor, or vm.runInNewContext() on non-constant strings
S-3006: External API calls MUST implement retry with exponential backoff (max 3 attempts, backoff factor 2) [ref: moldstud.com/articles/p-best-practices-for-building-robust-apis-with-nodejs-ultimate-guide]
S-3007: User input MUST be validated using Zod schemas before processing [ref: dev.to/codanyks/secure-by-design-nodejs-api-security-patterns-for-2025]
S-3008: Express routes MUST use express-rate-limit middleware (default: 100 req/15min per IP) [ref: moldstud.com/articles/p-best-practices-for-building-robust-apis-with-nodejs-ultimate-guide]

## Category 4: Architecture (A-Series)
A-4001: API versioning MUST use /api/v{N} format (e.g., /api/v1/entities) [ref: moldstud.com/articles/p-best-practices-for-building-robust-apis-with-nodejs-ultimate-guide]
A-4002: Next.js routes MUST use App Router pattern (app/ directory, not pages/ except for API routes)
A-4003: Server Components MUST be default; Client Components ONLY for interactivity requiring useState/useEffect [ref: ithy.com/article/nextjs-15-best-practices-guide]
A-4004: Shared types MUST live in packages/types workspace
A-4005: Extension background scripts MUST use message passing (never direct DOM manipulation)
A-4006: API responses MUST follow structure: {success: boolean, data?: T, error?: {code: string, message: string}} [ref: moldstud.com/articles/p-best-practices-for-building-robust-apis-with-nodejs-ultimate-guide]
A-4007: Error responses MUST include appropriate HTTP status codes: 400 (bad request), 401 (unauthorized), 404 (not found), 500 (server error) [ref: moldstud.com/articles/p-best-practices-for-building-robust-apis-with-nodejs-ultimate-guide]

## Category 5: Testing & Validation (V-Series)
V-5001: Test coverage MUST be ≥80% (jest --coverage --coverageThreshold='{"global":{"lines":80,"functions":80,"branches":80}}') [ref: jestjs.io/docs/configuration, moldstud.com/articles/p-steps-to-improve-code-coverage-from-0-to-80-using-jest]
V-5002: Validation sequence: TypeScript compilation → ESLint → Prettier → Jest (abort on TypeScript/test failure)
V-5003: Critical failures (TypeScript errors, test failures) MUST return non-zero exit code immediately
V-5004: Warnings (ESLint, Prettier) MUST continue with warnings array in output
V-5005: Jest MUST use --verbose --maxWorkers=50% --testTimeout=10000
V-5006: TypeScript MUST use strict: true, noImplicitAny: true, strictNullChecks: true [ref: betterstack.com/community/guides/scaling-nodejs/typescript-strict-option]
V-5007: ESLint MUST extend [@typescript-eslint/recommended, next/core-web-vitals, prettier]
V-5008: Test files MUST follow pattern: *.test.ts, *.spec.ts, or __tests__/*.ts with ≥1 test per public function (happy path + ≥1 error case)
V-5009: Integration tests MUST mock external APIs using MSW (Mock Service Worker) [ref: github.com/goldbergyoni/javascript-testing-best-practices]

## Category 6: Data & Storage (D-Series)
D-6001: MongoDB connections MUST use cached connection pattern to prevent exhaustion during hot reload [ref: apps/web/lib/mongodb.ts]
D-6002: Mongoose schemas MUST include timestamps: true and use strict mode
D-6003: Database writes MUST include metadata: {createdAt: Date, updatedAt: Date, source: string}
D-6004: Query timeouts MUST be configured via maxTimeMS: 30000 (30s) in Mongoose operations
D-6005: Redis caching MUST use TTL: 30 days (2592000s) for static data, 5 minutes (300s) for dynamic data
D-6006: Database queries MUST use lean() for read-only operations to improve performance by 3-5x
D-6007: Mongoose models MUST define indexes explicitly for frequently queried fields

## Category 7: Code Generation (G-Series)
G-7001: Generated code MUST declare imports in order: node builtins → external → internal
G-7002: Generated libraries MUST include version in package.json with semver format
G-7003: Generated classes MUST include toString() and toJSON() methods
G-7004: Generated async functions MUST use proper error handling with try/catch and specific error types [ref: site24x7.com/learn/nodejs-error-handling-guide]
G-7005: Generated API routes MUST implement request validation using Zod schemas
G-7006: Generated code MUST pass Prettier formatting (timeout=60s)
G-7007: Generated functions with external calls MUST catch specific exceptions (e.g., TypeError, NetworkError, never bare catch)
G-7008: Component creation order: types → implementation → tests → documentation (sequential, abort on failure)

## Category 8: Output & Reporting (O-Series)
O-8001: Use Winston logger for all logging (never console.log in production code) [ref: apps/web/lib/logger.ts]
O-8002: Winston log levels: error (file + console), warn (file + console), info (file), debug (dev only)
O-8003: Log files: logs/error.log (errors only), logs/combined.log (all levels)
O-8004: Success responses MUST include metadata: {executionTimeMs: number, itemsProcessed: number}
O-8005: API responses MUST be logged with: method, path, statusCode, responseTime, userId (if authenticated)
O-8006: Long-running operations MUST emit progress events at 25%, 50%, 75%, 100%
O-8007: Error objects MUST include: message, code, statusCode, timestamp, requestId

## Category 9: Refactoring & Improvement (R-Series)
R-9001: Refactoring MUST maintain 100% test pass rate (jest --onlyChanged for iterative testing)
R-9002: Performance improvements MUST show ≥20% gain via benchmark tests (statistical significance threshold) [ref: github.com/goldbergyoni/javascript-testing-best-practices]
R-9003: Baseline metrics MUST be captured before refactoring: executionTimeMs, memoryUsageMB, bundleSizeKB
R-9004: Refactoring MUST NOT increase cyclomatic complexity >2 points per function
R-9005: Refactoring MUST maintain/increase TypeScript strict mode compliance
R-9006: Generate 3-5 optimization variants using distinct approaches: algorithmic, memoization, lazy loading, code splitting
R-9007: Before merging, verify: jest --coverage → eslint → tsc --noEmit (all pass)
R-9008: Commits MUST include metrics: "refactor(scope): description | metric: before→after (+X%)"
R-9009: Deprecated functions MUST use @deprecated JSDoc tag with @since version and replacement function

## Category 10: Learning & Feedback (L-Series)
L-10001: Performance monitoring MUST use Next.js built-in metrics (Web Vitals: LCP, FID, CLS)
L-10002: API analytics MUST track: endpoint, method, avgResponseTime, errorRate, p95ResponseTime
L-10003: Error patterns MUST be analyzed weekly via Winston logs with pattern detection
L-10004: Critical issues affect >20% requests, high >10%, medium >5%, low ≤5%
L-10005: Bundle size MUST be monitored via next build --profile (alert if increase >10%)
L-10006: Extension performance MUST track: contentScriptLoadTime, backgroundScriptMemory, messageLatency

## Category 11: Type Safety & Validation (T-Series)
T-11001: Zod schemas MUST be defined for all API inputs/outputs with strict validation [ref: dev.to/codanyks/secure-by-design-nodejs-api-security-patterns-for-2025]
T-11002: TypeScript interfaces MUST include JSDoc examples for complex types
T-11003: Numeric types MUST use branded types for domain validation (e.g., PositiveInteger, ValidPort)
T-11004: Optional fields MUST use field?: Type (not field: Type | undefined for cleaner API)
T-11005: any type is PROHIBITED except in adapters/ directories; use unknown and type guards instead [ref: softwarepatternslexicon.com/patterns-js/27/15, betterstack.com/community/guides/scaling-nodejs/typescript-strict-option]
T-11006: External API data MUST be validated with Zod schemas immediately at boundary [ref: dev.to/codanyks/secure-by-design-nodejs-api-security-patterns-for-2025]
T-11007: Functions fetching external data MUST return validated typed objects, never any or unknown

## Category 12: Schema Awareness (M-Series)
M-12001: Before using Mongoose model, MUST verify schema exists and matches expected fields
M-12002: Zod schemas MUST be co-located with their usage (API route schemas in same file as route)
M-12003: Mongoose schema changes MUST include migration scripts in migrations/ directory
M-12004: Type definitions from Mongoose schemas MUST be exported via infer: type Entity = InferSchemaType<typeof entitySchema>
M-12005: Shared types MUST be defined once in packages/types and imported via workspace protocol