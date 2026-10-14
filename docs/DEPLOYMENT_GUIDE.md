# AINative Builder — Deployment Guide

This guide covers deploying `builder-ainative-studio` to production. **Railway is the
real, confirmed-live deployment target** — not Vercel. (An earlier version of this
doc described a Vercel-first setup; that was never accurate for this repo's actual
production deployment and has been corrected. See the note at the bottom if you're
evaluating Vercel as an alternative anyway.)

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [Build Process](#build-process)
4. [Deployment to Railway](#deployment-to-railway)
5. [Post-Deployment Verification](#post-deployment-verification)
6. [Monitoring](#monitoring)
7. [Troubleshooting](#troubleshooting)
8. [Rollback Procedures](#rollback-procedures)
9. [A note on Vercel](#a-note-on-vercel)

---

## Prerequisites

- **Node.js** 20.x (Railpack reads the project's engines/lockfile; keep local and
  CI Node versions aligned with what Railway actually builds with)
- **pnpm** package manager
- **Railway CLI** (`npm i -g @railway/cli`) and an authenticated account with
  access to the `AINative Studio - Production` project
- **PostgreSQL** — the app's own Drizzle-backed tables (auth, chat history,
  design tokens, deployment tracking, error logs, RLHF feedback). This is
  separate from ZeroDB (below) — don't conflate the two.
- **ZeroDB** — AINative's own data-layer API (`api.ainative.studio`), used for
  generated-app data and several Builder features (see
  `docs/design/BUILDER_DESIGN_HANDOFF.md` and this repo's `CLAUDE.md` for the
  authentication/workspace model). No local setup needed — it's a remote
  service, not something you provision per-deploy.
- **Redis** (session/cache; Upstash REST-compatible for Edge middleware)
- **Anthropic API** key, and/or AWS Bedrock credentials (`CODY_USE_BEDROCK`,
  `AWS_BEARER_TOKEN_BEDROCK`) — see `docs/MODEL_USAGE.md` for the real,
  current model configuration (do not trust older docs or memory describing a
  pure-Anthropic-direct setup; Bedrock is the current primary path)
- **Gitea** access (`git.ainative.studio`) — generated company code lives on
  Gitea, not GitHub. Don't assume a `github_repo_url: null` company has no repo.

## Environment Setup

### Clone and install

```bash
git clone https://github.com/AINative-Studio/builder-ainative-studio.git
cd builder-ainative-studio
pnpm install
```

### Environment variables

Real environment variables are managed through Railway's own variable store for
production — `railway variables --service builder-ainative-studio` — not a
committed `.env` file. For local development, pull or construct a `.env.local`
with the variables your task actually needs; check `lib/` and `app/api/` call
sites for the exact env var names in use rather than trusting a static list
here, since these have drifted from documentation before (see `docs/MODEL_USAGE.md`'s
own correction history). Known-real, currently load-bearing variables include:

- `NEXT_PUBLIC_BUILD_SHA` — baked into the build by `package.json`'s `build`
  script, sourced from `RAILWAY_GIT_COMMIT_SHA` on Railway or local `git
  rev-parse HEAD` otherwise. Surfaced at `/api/version`. Note: this can go
  stale relative to actual running behavior on CLI-triggered deploys — prefer
  checking `/api/health`'s `uptime`/real behavior over trusting this field
  blindly during active debugging.
- `DEPLOYMENT_ENCRYPTION_KEY` — AES-256-GCM key for encrypting stored
  deployment API tokens.
- Database connection vars for the Drizzle/Postgres layer (`db:*` scripts).
- Redis connection vars (session/cache + Upstash REST for Edge middleware).

### Database setup

```bash
pnpm db:generate   # generate migration files (drizzle-kit generate), if schema changed
pnpm db:migrate    # npx tsx lib/db/migrate.ts
pnpm db:studio     # Drizzle Studio at http://localhost:4983
```

This is Builder's own application database (auth, chat history, etc.) — it is
NOT where generated apps' data lives. Generated-app data goes through ZeroDB
via `/api/db/` (see `docs/design/BUILDER_DESIGN_HANDOFF.md`).

### Test locally

```bash
pnpm dev
open http://localhost:3000
```

Or, to run against the same Railway-provisioned environment variables the
production service uses (the pattern used throughout this session for local
verification work):

```bash
railway service builder-ainative-studio
railway run -- pnpm dev
```

---

## Build Process

```bash
pnpm build
```

This runs `next build --turbopack` with `NEXT_PUBLIC_BUILD_SHA` resolved from
`RAILWAY_GIT_COMMIT_SHA` (on Railway) or local git HEAD (elsewhere). There is
no separate database-migration step baked into `build` itself in this repo's
current script — migrations are run explicitly via `pnpm db:migrate`, not as
an automatic build side effect.

---

## Deployment to Railway

Railway builds with **Railpack** (`railway.json`: `"builder": "RAILPACK"`),
not a custom Dockerfile, and healthchecks `/health/live` (300s timeout, restart
on failure, up to 3 retries).

### GitHub-triggered auto-deploy (normal path)

Merges to `main` auto-trigger a Railway deploy. This has historically broken
and been fixed more than once (see `docs/BUILD_FLOW_REALNESS_BACKLOG.md` and
this repo's own commit history for incidents) — **verify it's actually firing**
rather than assuming:

```bash
gh api repos/AINative-Studio/builder-ainative-studio/deployments --jq '.[0]'
```

### CLI-triggered deploy (explicit/immediate, or while debugging)

This repo has a real `deploy` script:

```bash
pnpm run deploy
# equivalent to:
railway variables --service builder-ainative-studio \
  --set "NEXT_PUBLIC_BUILD_SHA=$(git rev-parse HEAD)" --skip-deploys
railway up --service builder-ainative-studio --ci --detach
```

Then poll for completion and verify:

```bash
railway deployment list --service builder-ainative-studio
curl -s https://builder.ainative.studio/api/health
```

Prefer `/api/health`'s real `uptime` and behavior over `/api/version`'s
`NEXT_PUBLIC_BUILD_SHA` field alone — that field can be stale relative to what's
actually running, particularly on CLI-triggered deploys. If in doubt, confirm
by checking for the actual code/behavior change you expect (e.g., grep a
served JS chunk for a function name you just added), not just the version
endpoint.

### `./scripts/deploy-production.sh`

This repo also has a dedicated `deploy:production` script
(`package.json` → `./scripts/deploy-production.sh`). Check that script directly
for its current behavior before relying on it in a runbook — it may overlap
with or supersede the `railway up` flow above; verify which is the intended
path before using either in an automated or high-stakes context.

---

## Post-Deployment Verification

```bash
curl https://builder.ainative.studio/api/health
curl https://builder.ainative.studio/api/version
```

`/api/health` returns real status (database connectivity, Redis status if
configured, recent error counts). Treat it as the source of truth over
`/api/version` for "is the new code actually live" questions.

Manual checklist:

- [ ] Homepage loads, no console errors
- [ ] Auth (login/registration via next-auth, backed by core's real
      `/v1/auth/login` + OAuth2.1/PKCE) works
- [ ] Chat creation + generation works end-to-end
- [ ] Preview rendering works — both the Sandpack multi-file path and the
      flattened single-file fallback (see `docs/design/BUILDER_DESIGN_HANDOFF.md`
      for the current dual-tier renderer and the in-progress self-hosting
      migration, epic #1076)
- [ ] Rate limiting behaves as configured
- [ ] `/api/health` reports healthy database/Redis status

---

## Monitoring

- **`error_logs` table** (Drizzle/Postgres) — queryable directly; see
  `docs/MONITORING_QUERIES.md` for real, current query patterns.
- **Railway's own dashboard/CLI** — `railway logs --service builder-ainative-studio`,
  `railway status`, deployment history.
- **`/api/health`** — the fastest live signal; prefer it to any dashboard for a
  quick "is it actually up" check.

---

## Troubleshooting

### Build/deploy issues

Check actual Railway build logs first, not assumptions:

```bash
railway logs --service builder-ainative-studio --build
```

If a CLI-triggered deploy seems stuck in "BUILDING" for an unusually long time,
cross-check Railway's own status page (https://status.railway.com) before
assuming the build itself is broken — CLI/dashboard status display lag has been
a real, repeated source of false alarms in this repo's deploy history.

### Database connection issues

```bash
pnpm db:studio   # verify connectivity via Drizzle Studio
```

### Test suite — use the real runner

```bash
npx vitest run       # NOT npx jest — jest silently fails to parse all TS
                      # tests in this repo and will falsely report passing
npx tsc --noEmit      # typecheck
```

### GitHub Actions / `gh pr checks` display lag

`gh pr checks` has repeatedly shown stale "pending" status for 10+ minutes
after a run actually completed. If a check seems stuck, verify directly:

```bash
gh api repos/AINative-Studio/builder-ainative-studio/actions/runs/{id}/jobs
```

---

## Rollback Procedures

### Git-based rollback (the real path for this repo)

```bash
git log --oneline
git revert <bad-commit> --no-edit
git push origin main
# triggers the normal auto-deploy path, or run `pnpm run deploy` explicitly
```

### Railway deployment rollback

Railway retains deployment history — a previous successful deployment can be
redeployed/promoted directly via the Railway dashboard or
`railway deployment list` + the appropriate Railway CLI/dashboard action for
your Railway plan. Check Railway's current docs for the exact rollback command,
since CLI surface area changes between Railway CLI versions.

### Database rollback

```bash
pg_dump $POSTGRES_URL > backup-$(date +%Y%m%d-%H%M%S).sql   # before any risky change
```

Drizzle doesn't support automatic migration rollback — reverting a schema
change means writing and running the reverse SQL by hand.

---

## A note on Vercel

Builder is a standard Next.js app, so it is *technically* deployable to
Vercel — but **production (`builder.ainative.studio`) does not run on
Vercel**, and this repo's deploy tooling (`railway.json`, the `deploy` script,
`DEPLOYMENT_ENCRYPTION_KEY`-gated per-company credential flows, Railway-specific
env vars like `RAILWAY_GIT_COMMIT_SHA`) is built around Railway specifically.
A stray `deploy:preview: vercel` script exists in `package.json` — verify
whether it's still in active use for anything (e.g. a personal preview
workflow) before relying on it; it is not part of the real production path.
If you're genuinely evaluating a platform migration rather than looking for
the current deploy process, treat that as a separate, deliberate decision —
not something to infer from this doc.
