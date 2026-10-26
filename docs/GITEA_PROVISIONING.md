# Gitea Provisioning Guide

This document covers the deployment and configuration of the self-hosted Gitea service for per-company git repositories.

## Overview

Gitea provides:
- **Per-company private repositories** — each company gets its own git repo
- **Agent commit-granularity** — each task becomes a branch + commit
- **Committee-gated PRs** — multi-model review before merge
- **Real ownership** — founders can fork/export their code

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      AINative Builder                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ gitea-client │  │ company-repo │  │ task-git-sync        │  │
│  │ (REST API)   │──│ (provision)  │──│ (branch/commit/PR)   │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│           │                                      │               │
│           ▼                                      ▼               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Gitea REST API                         │  │
│  │  /api/v1/orgs  /api/v1/repos  /api/v1/pulls  /api/v1/...│  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Gitea on Railway                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Gitea      │  │  PostgreSQL  │  │  S3 (LFS/assets)     │  │
│  │ (rootless)   │──│  (metadata)  │──│  (existing MinIO)    │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Deployment Steps

### 1. Create PostgreSQL Service

```bash
railway add --name gitea-db
railway variables set POSTGRES_DB=gitea
```

### 2. Deploy Gitea Service

```bash
cd deployment/gitea
railway up --service gitea
```

### 3. Configure Environment Variables

Set these in Railway for the builder service:

| Variable | Description | Value |
|----------|-------------|-------|
| `GITEA_BASE_URL` | Gitea service URL | `https://git.ainative.studio` |
| `GITEA_ADMIN_TOKEN` | Admin API token | (set in Railway, see step 5) |
| `GITEA_WEBHOOK_SECRET` | Webhook HMAC secret | (generate with `openssl rand -hex 32`) |

**Production URLs:**
- Gitea UI: https://git.ainative.studio
- API: https://git.ainative.studio/api/v1/

### 4. Configure Gitea Webhook

In Gitea admin (https://git.ainative.studio/admin/hooks):

1. Go to **Settings → Webhooks → Add Webhook**
2. URL: `https://builder.ainative.studio/api/webhooks/gitea`
3. Secret: Same as `GITEA_WEBHOOK_SECRET`
4. Events: Pull Request (opened, synchronized, reopened)
5. Active: Yes

### 5. Create Admin Token

1. Log into Gitea as admin
2. Go to **Settings → Applications → Generate New Token**
3. Name: `builder-admin`
4. Scopes: `write:organization`, `write:repository`, `write:user`
5. Copy token → Set as `GITEA_ADMIN_TOKEN`

## Org/Repo Structure

| AINative Concept | Gitea Entity | Naming |
|------------------|--------------|--------|
| Workspace | Organization | `ws-{workspaceId}` |
| Company | Repository | `{slug}` |
| Task | Branch | `task/{taskId}` |

Example:
```
Organization: ws-abc123
└── Repository: acme-corp
    ├── Branch: main (default)
    ├── Branch: task/t_abc_fix-login
    └── Branch: task/t_def_add-dashboard
```

## API Modules

### gitea-client.ts

Low-level Gitea REST API client:
- `configured()` — check if Gitea is configured
- `ensureOrg(workspaceId)` — create/get org (idempotent)
- `createRepo(org, slug)` — create/get repo (idempotent)
- `createTaskBranch(org, repo, taskId)` — create task branch
- `createTaskPR(org, repo, opts)` — create PR from task branch

### company-repo.ts

Per-company repo orchestration:
- `provisionCompanyRepo(opts)` — create org/repo + initial commit
- `commitRegeneration(opts)` — push regeneration to main
- `grantHumanWrite(slug, username)` — grant collaborator access

### task-git-sync.ts

Task → git synchronization:
- `createBranchForTask(slug, taskId)` — create task branch
- `commitTaskChanges(opts)` — push task changes to branch
- `commitTaskWithPR(opts)` — push + create PR

### committee-pr-gate.ts

PR review gate:
- `runStandardsGate(req)` — check coding standards
- `runCommitteeGate(req)` — full committee review
- `handlePRWebhook(payload)` — webhook handler

## Coding Standards Enforcement

The committee gate checks:

1. **No AI attribution** — commits/PR must not mention AI tools
2. **TDD compliance** — changed files should have tests
3. **Coverage threshold** — minimum 80% coverage

## Graceful Degradation

When `GITEA_BASE_URL` or `GITEA_ADMIN_TOKEN` are unset:
- All gitea-client functions return `null`
- No errors are thrown
- Build/deploy continues normally
- Git features are simply disabled

## Production Status

| Component | URL | Status |
|-----------|-----|--------|
| Gitea | https://git.ainative.studio | Live |
| Builder webhook | https://builder.ainative.studio/api/webhooks/gitea | Deployed |
| DNS | git.ainative.studio → Railway | Active |
| SSL | Let's Encrypt via Railway | Valid |

## Troubleshooting

### "Gitea not configured"
Set `GITEA_BASE_URL` and `GITEA_ADMIN_TOKEN` in Railway.

### "Branch creation failed"
Check that the repo exists and the admin token has write access.

### "PR webhook not triggering"
Verify webhook URL, secret, and event selection in Gitea.

### "Committee review pending"
The committee review is wired but may require additional setup.
Check lib/agent/committee-review.ts for configuration.

## Security Notes

- All repos are **private by default**
- Founders get **read-only mirror** access
- Human write access is **explicitly granted** via `grantHumanWrite()`
- Webhook signatures are **HMAC-SHA256 verified**
- Admin token should have **minimal required scopes**

## Incident: every company's repo was filed under one shared org, not per-founder (#1543, Oct 2026)

**What the "Org/Repo Structure" table above has always said is correct** —
`ensureOrg(workspaceId)` (`lib/git/gitea-client.ts`) is, and always was,
generic: it creates/fetches whatever org a caller passes in, with no
hardcoding inside the client itself (confirmed via `git show
c614fb8c:lib/git/gitea-client.ts`, the original #354/GIT-1 merge).

**What actually happened:** every real call site — `runGitCommit()` in
`lib/build/register-app-core.ts`, and both `provisionCompanyRepo()` calls in
`app/api/build/provision/route.ts` — passed a single fixed constant,
`BUILDER_WORKSPACE_ID` (`lib/build/instant-db.ts`), instead of each
founder's real, already-resolved `session.workspaceId` (set at login via
`resolveDefaultWorkspace()` in `app/(auth)/auth.ts`). So instead of the
intended shape —

```
Organization: ws-<founder-A-workspace-id>
└── Repository: acme-corp

Organization: ws-<founder-B-workspace-id>
└── Repository: beta-inc
```

— every company on the platform, regardless of which founder owned it,
landed in the exact same org:

```
Organization: ws-<BUILDER_WORKSPACE_ID>   (one org, platform-wide)
├── Repository: acme-corp     (founder A's company)
├── Repository: beta-inc      (founder B's company)
└── Repository: ...every other company ever created
```

**How this was found:** live-testing the company-track chat→task fix
(#1533/#1534) on 2026-10-25 — multiple company-track ventures, across
different founder accounts, were each individually confirmed (by asking
Cody directly, and by re-reading the actual provisioning code) to already
have a real Gitea repo, which contradicted the assumption that
company-track ventures never acquire one. Tracing *why* led straight to
this call-site bug, not a company-track-specific issue at all.

**The fix (PR #1544):** thread the real session `workspaceId` through at
both call sites that can provision a *new* repo. `runGitCommit()` now takes
an optional `workspaceId` param and resolves in priority order:

1. The caller's explicit, session-resolved `workspaceId` (the normal case —
   `register-app/route.ts` and `provision/route.ts` both already resolve a
   session earlier in their handlers for other reasons; this just reads
   `session.workspaceId` off the same resolution).
2. `existing.workspaceId` — the registry's own stored value (the #250
   field on `AppEntry`), for the session-less server-side reconciliation
   sweep (`registration-reconcile.ts`), which deliberately never borrows or
   impersonates a founder session.
3. `BUILDER_WORKSPACE_ID` — the shared constant, only as a last resort when
   neither of the above could be resolved. Never fails a commit outright
   for want of an identity a best-effort caller genuinely couldn't get.

**What this fix does NOT do:**

- **Does not migrate existing repos.** 36+ real companies were already
  provisioned under the shared org (`ws-<BUILDER_WORKSPACE_ID>`) before this
  fix landed. They stay there — this only changes where a *new* repo gets
  created going forward. A migration (moving existing repos into their
  founder's correct org, vs. leaving them grandfathered permanently) is a
  real, separate product decision, not made here.
- **Does not touch the identical ZeroDB-side pattern.** `AppEntry.workspaceId`
  itself (the #250 field this fix's fallback reads) is ALSO always written
  as `BUILDER_WORKSPACE_ID` today (`fileProjectUnderBuilderWorkspace()` in
  `lib/build/instant-db.ts`) — every company's ZeroDB project is filed under
  the same single shared core Organization too. That file's own comment
  says this is current, deliberate behavior pending core support for a real
  `workspace_id` on project creation (core PR #6460 referenced there) — it
  may not be the identical bug, and wasn't investigated as part of #1543.
  If it IS later confirmed to be the same mistake, note that fixing it
  would also fix this fix's own fallback #2 above, since `existing.workspaceId`
  is populated by that exact code path.

Refs: #354 (GIT-1 — the original locked "one org per workspace" decision
this corrects course back to), #1543 (this incident), #1544 (the fix),
`lib/build/register-app-core.test.ts`'s "workspace org resolution (#1543)"
suite (the resolution-priority logic, unit-tested).
