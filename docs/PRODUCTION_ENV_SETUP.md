# Production Environment Variables Setup

This guide covers the environment configuration needed for `builder.ainative.studio`
in production on **Railway** — not Vercel. (An earlier version of this doc was
Vercel-shaped throughout; corrected below. See `docs/DEPLOYMENT_GUIDE.md` for the
full deployment process.)

Production variables are managed via Railway's variable store, not a committed
`.env` file:

```bash
railway variables --service builder-ainative-studio
```

## Core Application Configuration

```bash
NODE_ENV=production
NEXT_PUBLIC_APP_URL=https://builder.ainative.studio

# Generate with: openssl rand -base64 32
AUTH_SECRET=<your-generated-secret>

# Baked into the build automatically from RAILWAY_GIT_COMMIT_SHA on Railway
# (or local git HEAD otherwise) — see package.json's `build` script. Don't set
# this manually in normal operation.
# NEXT_PUBLIC_BUILD_SHA=<auto>
```

## Database Configuration (Builder's own app DB — Drizzle/Postgres)

This is Builder's own application database (auth, chat history, design tokens,
deployment tracking, error logs, RLHF feedback) — separate from ZeroDB, which
holds generated-app data.

```bash
POSTGRES_URL=<postgres-connection-string>
DATABASE_URL=<postgres-connection-string>
```

## Redis Configuration

```bash
# Upstash REST API — required for Edge Runtime (middleware rate limiting)
UPSTASH_REDIS_REST_URL=<upstash-redis-rest-url>
UPSTASH_REDIS_REST_TOKEN=<upstash-redis-rest-token>

# Standard Redis — Node.js runtime (session management, caching)
REDIS_URL=<redis-url>
REDIS_TTL=86400
```

## AI/ML Service Configuration

**Check `docs/MODEL_USAGE.md` for the current, real model configuration before
setting these** — this has drifted before (a previous version of this doc
referenced `META_API_KEY`/`LLAMA_MODEL` for a Meta Llama path that no longer
exists; see that doc's own correction notes). As of the last verified pass:

```bash
# Primary path: AWS Bedrock
CODY_USE_BEDROCK=true
AWS_BEARER_TOKEN_BEDROCK=<bedrock-token>
# BEDROCK_MODEL_ID — see docs/MODEL_USAGE.md for the current model id in use

# Anthropic direct (when configured instead of/alongside Bedrock)
ANTHROPIC_API_KEY=<your-anthropic-api-key>

# OpenAI (embeddings / translation utilities)
OPENAI_API_KEY=<your-openai-api-key>

# DeepL (optional alternative translator)
DEEPL_API_KEY=<your-deepl-api-key>
```

Do not assume a specific `ANTHROPIC_MODEL` string or Meta/Llama variable is
still in use without checking `docs/MODEL_USAGE.md` and the real
`MODEL_CONFIG` in code — model routing has changed multiple times.

## ZeroDB Configuration

ZeroDB is AINative's own data-layer API (`api.ainative.studio`), used for
generated-app data and several Builder features — a remote service, not
something provisioned per-deploy.

```bash
ZERODB_MCP_URL=https://mcp.zerodb.io
ZERODB_MCP_API_KEY=<your-zerodb-api-key>
ZERODB_PROJECT_ID=<your-zerodb-project-id>
```

## Gitea (company code hosting)

Generated company repos live on Gitea (`git.ainative.studio`), not GitHub.

```bash
# See docs/GITEA_PROVISIONING.md for the real, current variable set and flow.
```

## Rate Limiting

```bash
MAX_CHATS_PER_HOUR=50
MAX_ANONYMOUS_CHATS_PER_HOUR=10
```

## Deployment Credentials Encryption

```bash
# AES-256-GCM key for encrypting stored per-company deployment API tokens.
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
DEPLOYMENT_ENCRYPTION_KEY=<your-encryption-key>
```

## Monitoring & Logging

```bash
LOG_LEVEL=info
SENTRY_DSN=<your-sentry-dsn>   # optional
```

## Railway-Specific Variables

These are automatically set by Railway, not something you configure:

```bash
RAILWAY_GIT_COMMIT_SHA   # read by package.json's build script
RAILWAY_ENVIRONMENT
RAILWAY_SERVICE_NAME
```

## Setting Variables

### Via Railway CLI

```bash
railway service builder-ainative-studio
railway variables --service builder-ainative-studio --set "KEY=value"

# Explicit production deploy with a specific build SHA (the repo's own
# `pnpm run deploy` script does exactly this):
railway variables --service builder-ainative-studio \
  --set "NEXT_PUBLIC_BUILD_SHA=$(git rev-parse HEAD)" --skip-deploys
railway up --service builder-ainative-studio --ci --detach
```

### Via Railway Dashboard

Project → Service → Variables tab. Scope to the correct environment
(production vs. any staging/preview environment that exists for this service).

### Local development

Pull or construct a `.env.local` with only the variables your current task
needs — or run against the real Railway-provisioned environment directly:

```bash
railway service builder-ainative-studio
railway run -- pnpm dev
```

## Validation

```bash
npx tsx scripts/validate-env.ts
```

Check that script's actual contents for what it currently validates — it may
not cover every variable listed above, and may check things not listed here.

## Troubleshooting

### Database connection issues

- Ensure `POSTGRES_URL` and `DATABASE_URL` are set to the same value.
- Check SSL mode (`?sslmode=require`) if the provider requires it.

### Redis connection issues

- Edge Runtime (middleware) requires the Upstash REST variables specifically —
  a standard `REDIS_URL` alone will not work there.
- Node.js runtime (API routes) can use either.

### Model/API key issues

- Verify against `docs/MODEL_USAGE.md` which provider path (Bedrock vs.
  Anthropic direct) is actually active before assuming a key is misconfigured.

### Build failures

```bash
railway logs --service builder-ainative-studio --build
```

Cross-check https://status.railway.com before assuming a build failure is
Builder-specific — CLI/dashboard status display lag has repeatedly caused
false alarms in this repo's deploy history.

## Monitoring Data

- `/api/health` — real-time health, DB/Redis connectivity, recent error counts.
- `/api/version` — build SHA (can be stale relative to actual running
  behavior on CLI-triggered deploys; prefer `/api/health` + real behavior
  checks when verifying a specific deploy landed).
- `error_logs` table (Drizzle/Postgres) — see `docs/MONITORING_QUERIES.md` for
  real, current query patterns.
