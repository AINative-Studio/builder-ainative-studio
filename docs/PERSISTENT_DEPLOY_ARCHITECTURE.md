# Persistent per-company cloud deploy + real primitive provisioning (#243)

Status: **MVP + seam shipped.** This documents what is REAL today, what is STUBBED,
and the target architecture a human can extend into.

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

### 1. Per-company ZeroDB project provisioning — REAL

- **Route:** `POST /api/build/provision` (Builder), `GET /api/build/provision?slug=` for status.
- Calls core's **idempotent** `POST /api/v1/zerodb/projects/ensure` with a stable
  `repo_hash = sha256("builder-company:{slug}")[:16]`, so repeated calls return the
  **same** project (no duplicates).
- The project is created **under the signed-in founder's account** (their bearer
  token) — they own it. Anonymous users are pushed into the signup funnel.
- The resulting `zerodbProjectId` + `provisionedAt` + `deployUrl` are persisted
  onto the company's `builder_app_registry` row via `setAppProvisioned()`
  (`lib/build/app-registry.ts`). Latest-wins read surfaces it.
- **Gating:** gated on the #241 `plan` field when present (`launch` | `company`
  → allow; unknown paid plan → HTTP 402 `upgrade`). Empty/missing plan is allowed
  for the MVP so the seam is exercisable; tighten to require a paid plan later.

### 2. Live systems read real per-company data — REAL (for 2 of 4 systems)

- `GET /api/build/systems` now checks the registry: if the company is provisioned,
  it reads counts **directly from the company's own ZeroDB project** tables
  (`deals`, `invoices`) via the AINative rows API, and returns `provisioned: true`.
- `buildSystems(counts, { provisioned })` marks **Pipeline** and **Invoices** as
  `provisioned: true` (real reads). **Helpdesk** and **Voice** stay
  `provisioned: false` — no per-company data source is wired for them yet, so the
  UI honestly renders `○ sim` vs `● live`.
- Un-provisioned companies fall back to the existing shared `/api/db` proxy path
  and honest zero-state.

## What is STUBBED / TODO

### Persistent hosting (the deploy seam) — STUB, documented

`lib/build/deploy.ts :: deployPersistent(chatId, slug)` is the **seam**. Today it
returns the **durable preview URL** (`{APP}/build/{slug}`, `kind: 'preview'`,
`dnsPointable: false`) — a real, working, persistent URL. It is TODO-marked to
swap in a real dedicated host. Headless Railway multi-service creation was **not**
attempted here (not safely automatable in this environment without risking real
charges / infra state), per the issue's "MVP + seam" guidance.

## Target architecture (for the human to extend)

Two candidate real hosts; `deployPersistent` is written so either drops in behind
an env flag and flips `dnsPointable` to `true`.

### Option A — Railway service per company
- On provision, create a Railway service that serves the company's built app
  (from `chatId`'s files) at `{slug}.up.railway.app`.
- Pros: true isolation, independent scaling. Cons: a service per company is heavy
  (cost, Railway project limits), and headless service creation + build is the
  hard part — needs a tested provisioner (`ensureRailwayService`).

### Option B — Shared `*.ainative.app` wildcard host (recommended MVP+1)
- One Railway service (or the Builder app itself) serves **all** companies behind a
  wildcard `*.ainative.app`. A **host → slug** rule in Builder middleware maps
  `Host: {slug}.ainative.app` → the same durable render as `/build/{slug}`.
- Pros: cheap (one service), instant per-company hostnames, no per-company infra
  provisioning. Cons: shared blast radius; needs the wildcard cert + middleware.
- Wire-up: set `AINATIVE_WILDCARD_HOST=ainative.app`; `deployPersistent` returns
  `https://{slug}.ainative.app` with `dnsPointable: true`; add a middleware host
  matcher that rewrites `{slug}.ainative.app/*` to the internal build render.

### How #240's DNS switches from URL301 → A/CNAME
Once `deployPersistent` returns a `dnsPointable: true` target:
- For Option B, point the customer's custom domain via **CNAME → `{slug}.ainative.app`**
  (or the wildcard host), and add the custom domain to the wildcard cert / Railway
  custom-domain list, instead of the current Namecheap 301 URL redirect.
- `namecheap_service.point_domain_at_app()` (core) gains a branch: if the app has a
  `dnsPointable` host, write a CNAME/A record; else keep the 301 fallback.

## Files (this PR)
- `lib/build/app-registry.ts` — `zerodbProjectId` / `provisionedAt` / `deployUrl` fields + `setAppProvisioned()`.
- `lib/build/deploy.ts` — `deployPersistent()` seam (NEW).
- `app/api/build/provision/route.ts` — provision endpoint (NEW).
- `lib/build/business-systems.ts` — `provisioned` flag; `buildSystems(counts, { provisioned })`.
- `app/api/build/systems/route.ts` — reads real counts from the provisioned project.
- `components/build/screens/Live.tsx` — "Provision cloud" affordance + `● live` / `○ sim` markers.
