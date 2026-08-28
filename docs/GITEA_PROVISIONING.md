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

| Variable | Description | Example |
|----------|-------------|---------|
| `GITEA_BASE_URL` | Gitea service URL | `https://git.ainative.studio` |
| `GITEA_ADMIN_TOKEN` | Admin API token | `gta_xxxxx` |
| `GITEA_WEBHOOK_SECRET` | Webhook HMAC secret | `whsec_xxxxx` |

### 4. Configure Gitea Webhook

In Gitea admin (https://git.ainative.studio/admin):

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
