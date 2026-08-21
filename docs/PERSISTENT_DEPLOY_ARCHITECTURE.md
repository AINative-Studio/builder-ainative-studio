# Persistent per-company cloud deploy + real primitive provisioning (#243)

Status: **Provisioning + wildcard host shipped.** Real per-company primitive
provisioning (Instant DB, temp→permanent claim on payment, ZeroPipeline) plus the
Option B shared `*.ainative.app` wildcard host (real dedicated, CNAME-pointable
per-company address). Only Option A (a dedicated Railway service per company)
remains a documented seam. This documents what is REAL and how to switch the
wildcard on.

## Problem

A company shipped from `/build` renders only via the sandbox preview
(`/build/{slug}`, backed by the ZeroDB-persisted preview store). That URL is
durable and shareable, but:

1. It is **not a dedicated per-company host** — it lives under the shared
   `builder.ainative.studio` origin as a subdirectory, so it **cannot accept a
   DNS A/CNAME record** for a custom domain. #240 therefore points a purchased
   domain at it with a **301 URL redirect**, not a real DNS record.
2. The company had **no real backing primitives** — the Live dashboard's business
   systems (Pipeline / Invoices / Helpdesk / Voice) were placeholders, so "Live"
   showed simulated numbers.

## What is REAL today (this PR)

### 1. Per-company data layer via Instant DB — REAL (one AINative key)

- **Route:** `POST /api/build/provision` (Builder), `GET /api/build/provision?slug=` for status.
- Calls AINative **Instant DB** `POST /api/v1/public/instant-db` (body `{ agree_terms: true }`)
  — a real per-company ZeroDB project + key in ONE request. Verified live (2026-08-20):
  the endpoint provisions a project and returns `{ api_key, project_id, base_url, expires_at, claim_url, … }`.
- **Two paths off the ONE AINative identity (unified auth):**
  - **Signed-in founder** (next-auth session carries an AINative JWT) → provision
    **authenticated** → **permanent `sk_` key**, auto-assigned to their Default
    Workspace. `keyKind = 'permanent'`. No claim needed.
  - **Anonymous** → provision **unauthenticated** → **`tmp_` key** (72h expiry) +
    a **claim token** (parsed from the returned `claim_url?token=…`). `keyKind = 'tmp'`.
- The `zerodbProjectId` + `keyKind` (+ `claimToken` for tmp_) + `provisionedAt` +
  `deployUrl` are persisted onto the company's `builder_app_registry` row via
  `setAppProvisioned()` (`lib/build/app-registry.ts`). Latest-wins read surfaces it.
  The raw `sk_`/`tmp_` **api_key is NOT persisted** in the shared registry (data-plane
  secret) — only the `project_id` identifier + the claim token.
- **Gating:** gated on the #241 `plan` field when present (paid plan → allow; unknown
  paid plan → HTTP 402 `upgrade`). Empty/missing plan is allowed for the MVP.

### 1b. Temp → permanent claim on payment — REAL (#241 coordination)

- `claimCompanyProject(slug, jwt)` (`lib/build/app-registry.ts`) upgrades a `tmp_`
  project to permanent by calling **`POST /api/v1/public/instant-db/claim`** with
  `{ token, project_id }` + the founder's JWT (verified live: the endpoint expects
  field `token`, returns a new permanent key, 409 = already-claimed treated
  idempotently). It then flips `keyKind → 'permanent'` and drops the spent token.
- Invoked from the #241 post-checkout return path
  (`app/api/build/subscription/verify/route.ts`) once payment is verified. Best-effort:
  never blocks checkout. So an anonymous founder who provisions and then pays keeps
  their data (no 72h expiry, no re-provision).
- **Dependency:** #241's verify route lives on `feature/issue-241-subscription-provisioning`.
  This branch ships a **superset** of that route (verify + claim hook); if both PRs
  land, keep this version. The registry `AppEntry` here also carries **both** #241
  (`plan`/`enrolled`) and #243 fields so the two branches merge cleanly.

### 2. Live systems read real per-company data — REAL (honestly per-primitive)

- `GET /api/build/systems` checks the registry: if the company has a provisioned
  ZeroDB project, it reads counts **directly from that project's** `deals`/`invoices`
  tables via the AINative rows API, and returns `provisioned: true`.
- **ZeroPipeline (CRM primitive) — REAL for signed-in founders.** On provision, if we
  have the founder's JWT we call **`POST {pipeline.ainative.studio}/api/v1/pipelines`**
  (ZeroPipeline is JWT-auth and auto-provisions the org from the token — verified via
  its api-quickstart) to create the company's real pipeline, and persist
  `pipelineProvisioned`. `buildSystems` then marks the **Pipeline** card `● live`.
- **Invoices** is marked `● live` once the per-company ZeroDB project exists (its
  counts read from the company's own `invoices` table). **Helpdesk** and **Voice**
  stay `○ sim` — no per-company data source wired yet.
- Un-provisioned companies fall back to the existing shared `/api/db` proxy path
  and honest zero-state.

> **Cross-primitive auth note (directive #1):** ZeroPipeline authenticates with an
> AINative **JWT** (auto-provisioning users/orgs from the token), **not** the Instant
> DB `sk_`/`tmp_` api-key. So ZeroPipeline is provisionable for **signed-in** founders
> (we have their JWT) but not from the unauthenticated systems GET (which only has the
> Builder server key). Tracking issue opened on `AINative-Studio/ZeroPipeline` to add
> an api-key / agent-token auth path + a documented per-company provision endpoint so
> the Builder can wire ZeroPipeline reads without a live user JWT. (ZeroInvoice/ZeroVoice
> per-company provisioning likewise deferred until such an endpoint exists.)

## Persistent hosting — Option B (wildcard host) IMPLEMENTED

`lib/build/deploy.ts :: deployPersistent(chatId, slug)` now returns a **real
dedicated host** when the shared wildcard is configured:

- **`AINATIVE_WILDCARD_HOST` set** (e.g. `ainative.app`) → returns
  `https://{slug}.ainative.app` with `kind: 'wildcard'`, **`dnsPointable: true`**.
  The Builder itself serves that host: `middleware.ts` rewrites
  `Host: {slug}.ainative.app/*` → the internal `/build/{slug}` render via
  `wildcardSlugFromHost()` (apex + `www` are excluded; unit-tested in
  `__tests__/lib/wildcard-host.test.ts`). No per-company service is provisioned.
- **env unset** (current prod default) → falls back to the durable preview URL
  (`{APP}/build/{slug}`, `kind: 'preview'`, `dnsPointable: false`), unchanged.

So flipping this on is a single env var + a wildcard DNS/cert for `*.ainative.app`
on the Builder service — no code change and no per-company infra.

### How #240's DNS follows automatically
`namecheap_service.point_domain_at_app()` (core) now branches on the same env:
- **`AINATIVE_WILDCARD_HOST` set** → `www` gets a **CNAME → `{slug}.ainative.app`**
  and the apex (`@`) URL301-forwards to `https://www.{domain}` (apex can't hold a
  CNAME per DNS rules). Returns `mode: 'cname'`.
- **unset** → the prior apex+www URL301 redirect straight to `/build/{slug}`
  (`mode: 'redirect'`).

To go live end-to-end: (1) point `*.ainative.app` DNS + wildcard TLS at the Builder
Railway service, (2) set `AINATIVE_WILDCARD_HOST=ainative.app` on both Builder and
core, (3) add each purchased custom domain to the Builder service's custom-domain
list so its cert covers it (the CNAME then resolves with TLS).

## Still a seam — Option A (per-company Railway service)

A dedicated Railway **service per company** (own backend at `{slug}.up.railway.app`,
independent scaling/isolation) remains the heavier future option. Headless
multi-service creation was **not** automated here (not safely automatable without
risking real charges / infra state). `deployPersistent` keeps a documented branch
(`RAILWAY_DEPLOY_ENABLED` + `ensureRailwayService`) where it drops in.

## Files (this PR)
- `lib/build/instant-db.ts` — Instant DB client (`provisionInstantDb`, `parseClaimToken`) (NEW).
- `lib/build/zeropipeline.ts` — ZeroPipeline pipeline provisioner (`provisionPipeline`) (NEW).
- `lib/build/app-registry.ts` — `zerodbProjectId` / `keyKind` / `claimToken` / `pipelineProvisioned` / `deployUrl` fields + `setAppProvisioned()` + `claimCompanyProject()` + `setAppPlan()` (superset of #241).
- `lib/build/deploy.ts` — `deployPersistent()` returns a real `{slug}.ainative.app`
  wildcard host when `AINATIVE_WILDCARD_HOST` is set; `wildcardUrl()` +
  `wildcardSlugFromHost()` helpers.
- `middleware.ts` — rewrites `{slug}.ainative.app/*` → `/build/{slug}` (host→slug).
- `__tests__/lib/wildcard-host.test.ts` — unit tests for the host→slug logic (NEW).
- `services/namecheap_service.py` (core) — `point_domain_at_app()` CNAMEs www →
  `{slug}.ainative.app` when the wildcard host is set, else the URL301 fallback.
- `app/api/build/provision/route.ts` — real Instant DB + ZeroPipeline provisioning.
- `app/api/build/subscription/verify/route.ts` — #241 verify + #243 claim-on-payment hook (superset).
- `lib/build/business-systems.ts` — per-primitive `provisioned` flags; `buildSystems(counts, { provisioned, pipelineProvisioned })`.
- `app/api/build/systems/route.ts` — reads real counts from the provisioned project; surfaces `pipelineProvisioned`.
- `components/build/screens/Live.tsx` — "Provision cloud" affordance + `● live` / `○ sim` markers.
