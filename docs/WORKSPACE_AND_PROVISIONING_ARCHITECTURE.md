# Workspace, Project & Provisioning Architecture (Builder)

**Audience:** AINative Builder engineers doing bug fixes or upgrades on the
company-provisioning, custom-domain, wildcard-host, or workspace/project layers.

**Status:** Live as of 2026-08-21. Supersedes ad-hoc notes; pairs with
[`PERSISTENT_DEPLOY_ARCHITECTURE.md`](./PERSISTENT_DEPLOY_ARCHITECTURE.md) and
[`AINATIVE_PRIMITIVES.md`](./AINATIVE_PRIMITIVES.md).

---

## TL;DR of the object model

| Concept | What it is | Cardinality |
|---|---|---|
| **Workspace** (= `organization` in core) | Billing/ownership container. `project.organization_id` FKs to it. | Builder uses ONE: **AINative Builder** |
| **Project** (ZeroDB project) | Isolated data layer: tables, vectors, memory, file storage, its own `api_key`. | **One per generated app/company** + a couple of platform projects |
| **Company/App** | A thing a user builds in `/build`. | 1 company = 1 ZeroDB project |

**Rule of thumb:** *every app or company is a ZeroDB project; all Builder projects
live under the single **AINative Builder** workspace.*

---

## Key IDs (live)

| Thing | ID | Notes |
|---|---|---|
| **AINative Builder** workspace | `5d2376e1-d4f0-4193-9a7f-84e4543a8f9a` | Created 2026-08-21. Home for all Builder projects. |
| Builder **registry** project | `ZERODB_PROJECT_ID=5dfbc60c-7463-4e21-ac68-9bbe536f9adf` | Holds the `builder_app_registry` table (slug↔chatId↔domain↔plan↔provisioning). Shared bookkeeping, NOT per-company. |
| Builder **Platform / memory** project | `8a13b788-4b9b-4156-b93d-6ea087f22ede` | Under the Builder workspace. Agent memory for the Builder app itself. Scoped key in `BUILDER_MEMORY_API_KEY`. |
| Builder key identity | `admin@ainative.studio` / org `0f244da9-…` (AINative Studio) | The `AINATIVE_API_KEY` the Builder server uses. Its **default** workspace is still "AINative Studio" — see migration note below. |

---

## How allocation works TODAY (be precise when changing this)

### Workspace → Project
- The Builder server authenticates with **one key** (`AINATIVE_API_KEY`, the
  `admin@ainative.studio` identity — unified auth across all primitives).
- **Instant DB** (`POST /api/v1/public/instant-db`, body `{agree_terms:true}`) is
  how a per-company project is created. See `lib/build/instant-db.ts`.
  - **Signed-in founder** (next-auth session carries an AINative JWT) → the call is
    authenticated → **permanent `sk_` key** + a project **auto-assigned to the
    caller's *default* workspace**.
  - **Anonymous** → **`tmp_` key** (72h) + a `claim_token`; upgraded to permanent on
    payment via `POST /api/v1/public/instant-db/claim` (see
    `claimCompanyProject()` in `lib/build/app-registry.ts`, hooked from
    `app/api/build/subscription/verify/route.ts`).
- So **each company gets a UNIQUE `project_id`** (and its own key), but **NOT a unique
  workspace**. Projects all land in whatever the key's default workspace is.

### ⚠️ Current gap (important for the workspace migration)
- Instant DB today accepts **only** `{agree_terms}` — it does **not** take a
  `workspace_id`/`organization_id`, so it always drops the project into the
  **default** workspace of the identity. As of 2026-08-21 the Builder key's default
  is still **"AINative Studio"**, where **71 of 80 projects** already piled up.
- The full **project-create** API (`POST /api/v1/projects`) **does** accept
  `organization_id` (verified — the Platform project was created straight into the
  Builder workspace this way). So there are two ways to get new company projects into
  the Builder workspace:
  1. **Core change (preferred):** have Instant DB accept an optional
     `workspace_id`/`organization_id` and pass the Builder workspace. Tracked as a
     follow-up (see below).
  2. **Interim:** set the Builder key's **default workspace** to *AINative Builder* so
     Instant-DB auto-assignment lands there. (Moves the default for that identity —
     coordinate, since the identity is shared with other tooling.)
- Existing 71 projects can be **migrated** by re-parenting `organization_id` (the
  workspace-delete flow already migrates projects, proving re-parenting is supported).

---

## The end-to-end company lifecycle (where each piece lives)

```
User describes idea in /build
016G  brand generated (app/api/build/brand)                → name/slug/tagline/color
016G  app generated (chatId) + registered                 → lib/build/app-registry.ts (registry project)
016G  served at builder.ainative.studio/build/{slug}       → durable preview (ZeroDB)
016G  [paid] POST /api/build/provision                     → Instant DB → per-company ZeroDB project (UNIQUE project_id)
010A          + ZeroPipeline pipeline (if signed in)       → lib/build/zeropipeline.ts
016G  [wildcard host] {slug}.ainative.studio               → middleware host→slug rewrite (see below)
016G  [custom domain] POST /api/build/domains (buy)        → Stripe → core register + DNS (see below)
016G  [payment] subscription/verify                        → setAppPlan + claimCompanyProject (tmp_→sk_)
```

### Wildcard host `{slug}.ainative.studio` (LIVE)
- `middleware.ts` rewrites `Host: {slug}.ainative.studio/*` → `/build/{slug}` via
  `wildcardSlugFromHost()` (`lib/build/deploy.ts`), gated on env
  `AINATIVE_WILDCARD_HOST=ainative.studio` (set on Builder **and** core).
- **DNS is managed at NETLIFY** (zone `ainative.studio`). Railway holds
  `*.ainative.studio` as a custom domain on the **builder-ainative-studio** service
  (target `iyofw6ls.up.railway.app`, cert valid).
- **Existing sibling apps are protected two ways:** (1) explicit DNS records take
  precedence over `*`, so `zerodb./docs./chat./…` keep resolving to their own
  services; (2) `RESERVED_SUBDOMAINS` (in `lib/build/deploy.ts`) is synced to all ~45
  real subdomains + infra labels so the rewrite never hijacks a sibling.
  **When you add a new `*.ainative.studio` app, add its label to
  `RESERVED_SUBDOMAINS`.**

### Custom domains (LIVE)
- Buy: `POST /api/build/domains` → core `POST /api/v1/public/domains/purchase`
  (Stripe Checkout, $25 std / $99 premium) → on paid, core `…/domains/fulfill`
  verifies payment then registers (Namecheap) + points DNS.
- DNS target: core `namecheap_service.point_domain_at_app()`. With
  `AINATIVE_WILDCARD_HOST` set, it **CNAMEs `www → {slug}.ainative.studio`** (apex
  URL301→www); else falls back to a URL301 redirect to `/build/{slug}`.
- **Two DNS zones — don't confuse them:** the customer's bought domain lives at
  **Namecheap** (where the CNAME is written); our `*.ainative.studio` wildcard lives
  at **Netlify**.

---

## Agent memory scoping (this project)

- `BUILDER_MEMORY_PROJECT_ID=8a13b788-…` + `BUILDER_MEMORY_API_KEY=sk__…` (Railway
  vars on the Builder service) scope the Builder app's **own** agent memory to the
  **AINative Builder — Platform** project under the Builder workspace, so those
  memories surface in that project rather than being mixed into per-company data or
  the shared registry project.
- This is distinct from the **registry** project (bookkeeping) and from **per-company**
  projects (each company's runtime data).

---

## Environment variables (Builder service)

| Var | Purpose |
|---|---|
| `AINATIVE_API_KEY` | Unified key the Builder server uses for all primitive calls |
| `ZERODB_PROJECT_ID` | The registry project (`builder_app_registry` table) |
| `AINATIVE_WILDCARD_HOST` | `ainative.studio` — activates `{slug}.ainative.studio` routing + CNAME mode |
| `BUILDER_MEMORY_PROJECT_ID` / `BUILDER_MEMORY_API_KEY` | Scoped agent-memory project + key (Builder workspace) |

---

## Follow-ups / known gaps

- **Instant DB workspace targeting** — add optional `workspace_id` so new company
  projects go straight into the AINative Builder workspace (core change). Until then,
  they inherit the key's default workspace.
- **Migrate the ~71 existing company projects** from "AINative Studio" → "AINative
  Builder" (re-parent `organization_id`).
- **ZeroPipeline api-key auth** (`AINative-Studio/ZeroPipeline#460`) — needed so the
  nightly loop can read CRM data with the server key (not just a live founder JWT).
- **Per-company Railway service (Option A)** remains a documented seam for companies
  that need their own backend; today they share the wildcard host.
