# PRD — Builder `/build` Flow Realness Pivot

**Status:** Active
**Epic:** [#207 — Pivot Builder positioning to "AI that runs your company" (beat Polsia)](https://github.com/AINative-Studio/builder-ainative-studio/issues/207)
**Author:** Cody (AI engineer) — reconciled with Toby Morning
**Created:** 2026-08-19
**Source of truth (design):** `/Users/aideveloper/Downloads/design_handoff_builder` (Modernist system; 03-FLOW.md, 04-SCREENS.md)

---

## 1. Problem

The `/build` experience (the pivot UX from the Claude Design handoff) was shipped as a
**static clickable skin** — a narrated slideshow of one hardcoded example product ("ask
the company anything" knowledge search). An audit against the design spec found:

- ~30% of the specified screens/flows built; the rest missing or non-functional.
- **The flow dead-ended** — autoplay walked only prose artifacts then froze at artifact 1;
  swarm/infra/preview were skipped; the App track never completed; decision modal, wedge,
  and conflict were orphaned (defined but never triggered).
- **Nothing was real** — every artifact rendered hardcoded prose regardless of the user's
  idea; the Preview showed a fake app; the Live dashboard faked metrics.

This directly contradicts the pivot's thesis (EPIC #207): *"AI that builds AND runs your
company."* A prospect who lands on `/build`, types an idea, and hits a frozen mock will not
believe we beat Polsia. The `/build` flow must **actually work end-to-end and actually build
real things** — that is the product demo, the funnel, and the proof, all at once.

## 2. Goal

`/build` takes a founder from a one-line idea to an operating, AI-run company, with Cody doing
the work in real time on real AINative primitives — matching the design spec, with **no
dead-ends** and **no faked artifacts**. This is both the marketing spectacle (watch Cody build)
and the product (the real thing gets built).

### Non-goals
- Rebuilding the codegen engine (reuse `/api/chat-ws` + sandbox).
- The SEO/AEO workstream (tracked separately under #214–217).
- Homepage repositioning (#208) — this PRD is the `/build` app itself.

## 3. Users

- **Founder (primary):** describes an idea, watches Cody build, converts at the pricing gate,
  supervises the live company. Includes **anonymous/free** visitors (the funnel top).
- **Paid founder:** gets the real agent-swarm build, real deploy, real business systems.
- **AINative agents (secondary):** the nightly loop operates each enrolled company.

## 4. Requirements

### 4.1 Flow (must run end-to-end, no dead-ends)
- **R1** Fork → Intake → Workspace, both tracks (App, Company). *(done today)*
- **R2** Autoplay walks the **entire** track sequence — App: brief→prd→comp→dataModel→
  memoryPolicy→agentDef→apiSpec→backlog→swarm→infra→preview; Company: thesis→wedge→
  businessModel→positioning→landing→plan30. No view skipped. *(done today)*
- **R3** App track completes → `MVP_DONE` → "Make it real" → Pricing. *(done today)*
- **R4** Company track completes → "See it live" → Live dashboard. *(done today)*
- **R5** Decision modal fires for a real product call (data-privacy posture); resumes on answer. *(done today)*
- **R6** Wedge challenge interrupts the Company track and hands the user the wheel. *(done today)*
- **R7** Dependency Conflict fires as a blocking gate when an upstream edit has downstream
  impact; Artifact Graph renders the real composition structure and is reachable. *(PENDING — #234)*

### 4.2 Realness (artifacts must reflect the idea, via real backends)
- **R8** Every prose artifact generates from the user's idea via Claude, tiered by plan
  (Haiku 4.5 / Sonnet 4.5 / Opus 4.5), server-side, working for anonymous users. *(done today)*
- **R9** Preview renders the **actual generated app** from the idea (codegen + sandbox),
  not a mock. *(done today, sandbox)*
- **R10** "Ask Cody anything" on Live is a **working** chat, grounded in the company. *(done today)*
- **R11** Live metrics are **honest** (zero-state for a new company) and weave in **real
  `/intelligence` platform-loop data**. *(done today)*
- **R12** Swarm reflects a **real agent-swarm run** for paid tiers. *(PENDING — #232, blocked by core#6422)*
- **R13** Live business-systems (Pipeline/Invoices/Helpdesk/Voice) show **live data from
  their real primitives** for enrolled companies. *(PENDING — #233)*
- **R14** "Make it real" produces a **persistent, shareable live deploy** (not just a
  sandbox), with working infra controls. *(PENDING — #236, w/ #213)*

### 4.3 Chrome & fidelity (match the design spec)
- **R15** Generation overlays (forming/swarm/provisioning) + terminal ribbon. *(done today)*
- **R16** Artifact rail drawer (categorized, counts, graph link), Index/jump toggle, account
  token-chip w/ meter, per-artifact IDs + status pills + Draws-from/Feeds cross-links. *(PENDING — #235)*

### 4.4 Cross-cutting
- **R17** Full-bleed Modernist ground; no white gutters at any viewport. *(done today)*
- **R18** Every requirement above is **verified on production** (`builder.ainative.studio`),
  not just locally, before its issue is closed. *(PROCESS)*

## 5. Data model (state)

The `/build` state machine (`lib/build/state.ts`) holds: `screen`, `track`, `view`, `plan`,
`auto`/`paused`/`building`, `done`/`generated`/`genError` (per-view), `overlay`, `ribbon`,
`answers` (privacy/wedge), `askedPrivacy`, `builtMVP`/`builtCompany`, `companyName`/`appSub`.
Generation content is keyed by artifact view. The generated app is keyed by codegen `chatId`
in the preview store. Enrollment persists to ZeroDB (`builder_loop_enrollments`).

## 6. Acceptance criteria (verified on PRODUCTION)

A requirement is DONE only when its criterion passes on `builder.ainative.studio`:
- **AC-flow:** App & Company tracks each run idea→terminal state with zero dead-ends;
  every overlay + the decision modal + the wedge appear.
- **AC-real-artifacts:** submitting two different ideas yields two different, idea-specific
  artifact sets (no shared hardcoded text).
- **AC-preview:** the Preview renders a working app that reflects the idea.
- **AC-chat:** Ask Cody returns a company-specific answer.
- **AC-honest:** Live metrics show zero-state for a new company; no fabricated numbers.
- **AC-pending (R7,R12,R13,R14,R16):** tracked by #232–236; each closes only on its own
  production acceptance.

## 7. Backlog

See `docs/BUILD_FLOW_REALNESS_BACKLOG.md` for the full issue backlog derived from these
requirements, and the corresponding repo issues under EPIC #207.

## 8. Rollout

Each backlog item: branch → implement → local test → deploy to Railway builder service →
**re-verify on production** → close issue with production proof. Nothing is closed on
"UI merged" — only on production acceptance (R18).
