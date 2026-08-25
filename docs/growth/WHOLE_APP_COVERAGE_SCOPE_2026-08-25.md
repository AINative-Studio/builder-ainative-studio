# Whole-App 80% Coverage — Scope & Estimate

**Date:** 2026-08-25 · **Author:** growth/eng
**Goal:** raise coverage across the *entire* builder app to ≥80%, not just the core `lib/build` logic (currently ~98%).

## Where we are (measured, not estimated)

| Area | Files | ~LOC | Current stmt coverage |
|---|---|---|---|
| `lib/build` (done) | 49 | — | **98%** ✅ |
| `lib/growth` (done) | few | — | **100%** ✅ |
| **Rest of `lib/`** | 154 (140 pure) | ~40k | ~30% (aggregate lib = 49%) |
| `app/api/**` route handlers | 139 routes | ~28k (app total) | **~10%** |
| `app/**` pages/layouts | 46 pages | (in app total) | **~6%** |
| `components/**` (React UI) | 154 .tsx | ~26k | **~0%** |
| **Whole repo aggregate** | ~560 source | ~107k | **14.2%** |

Test assets today: **133 unit/integration** files, **62 Playwright** specs. Infra: `@testing-library/react` installed, **`jsdom` NOT installed**, and we hit **OOM on some component import chains** (e.g. `useAutoplay`'s transitive `artifact-prompts → primitive-catalog` chain allocated ~500MB and crashed the jsdom worker). This is the single biggest technical risk for the UI tier.

## The work, by testability tier

### Tier 1 — Rest of `lib/` pure logic (~140 files) — HIGH value, LOW cost
Same as what we just did for `lib/build`: pure functions, mock I/O, fast deterministic tests. This is the cheapest coverage per file and the highest bang-for-buck (real bugs surface here — we found one during the lib/build pass). Some of these 140 are thin/re-exports (fast), some are substantial (services, db queries, agent logic).
- **Effort:** ~6–9 agent-waves (like this session's coverage push). ~10–20 files/agent.
- **Risk:** low. Some files touch DB/external services → careful mocking (the guest-user-fallback timeout we hit is the pattern to avoid).

### Tier 2 — API route handlers (`app/api`, 139 routes) — MEDIUM value, MEDIUM cost
Route handlers are thin wrappers over lib logic (which Tier 1 covers). Testing them means mocking `NextRequest`/session/env and asserting status codes + response shapes. Much of the *logic* is already tested via extracted lib functions; the routes add plumbing coverage.
- **Effort:** ~4–6 waves. Many routes are near-identical patterns (auth-gate → call lib → respond), so templatable.
- **Risk:** low-medium. The Next 15 "route files export only handlers" rule bit us twice already — some helpers must move to lib first (a refactor cost).

### Tier 3 — React components (`components/` 154 + `app` pages 46 = 200 files) — LOWER value, HIGH cost
This is the expensive, risky tier and the bulk of the remaining gap.
- **Blocker: install + stabilize jsdom** and fix the OOM import chains (may need per-test module mocking or lazy imports). Without this, component render-tests don't run reliably.
- Each component needs render tests (props, states, interactions) — slow to write, brittle, lower defect-catch rate than logic tests.
- Many are presentational (little logic) — high LOC, low real risk; testing them is coverage-theater unless paired with the E2E seam (#84).
- **Better approach for UI confidence:** the **E2E test seam (#84)** + Playwright drives real user flows through the components in a real browser — catches more real bugs than unit-rendering 200 components. Recommend E2E-first for UI, unit-render only for components with real logic.
- **Effort:** ~10–16 waves + upfront infra (jsdom + OOM fixes). The largest single chunk.

## Estimate summary

| Tier | Files | Waves (~3-5 agents each) | Relative cost | Real value |
|---|---|---|---|---|
| 1. lib/ pure logic | ~140 | 6–9 | Low | **High** (bugs surface) |
| 2. API routes | 139 | 4–6 | Medium | Medium |
| 3. React components + pages | ~200 | 10–16 + infra | **High** | Lower (E2E better) |
| **Total to hit whole-repo 80%** | ~480 | **~20–30 waves** | — | — |

- **Wall-clock (fleet, parallel like this session):** roughly **3–5 focused sessions** of sustained fan-out.
- **Token/compute cost:** large — this session's `lib/build` push (~50 files → 98%) was ~5–6 agents; the whole app is ~10× that surface.

## Recommendation (staged, value-ordered)

1. **Phase 1 — Tier 1 (rest of `lib/`) to 80%.** Cheapest, highest value, same proven playbook. **Do this first.** Extend the CI threshold `include` to `lib/**` as each area clears. → lifts whole-repo coverage meaningfully and finds real bugs.
2. **Phase 2 — Tier 2 (API routes) to 80%.** Templatable; pairs with moving route helpers to lib (which also fixes latent build issues like the ones we hit).
3. **Phase 3 — build the E2E seam (#84) + Playwright coverage of key UI flows** — get *real* UI confidence cheaply, then unit-render only the logic-heavy components.
4. **Phase 4 — remaining component unit tests** to close the last gap to whole-repo 80% (the long, expensive tail — do only if a hard 80%-everything gate is required).

**Honest take:** Phases 1–2 get the *meaningful* code (logic + routes) to 80% at reasonable cost and will catch real bugs. Phase 4 (unit-rendering 200 presentational components) is the expensive tail that mostly moves the % without proportional risk reduction — worth it only if a strict whole-repo 80% gate is a hard requirement. If the goal is *confidence*, Phases 1–3 deliver most of it; if the goal is the *number*, Phase 4 is required.

## Prerequisites / infra to unblock
- [ ] Install `jsdom` (dev dep) for component render tests.
- [ ] Fix the component-import OOM (lazy-load / mock the `artifact-prompts→primitive-catalog` chain in test env).
- [ ] Move any remaining non-handler exports out of route files into `lib` (Next 15 rule) as routes get tested.
- [ ] Expand `vitest.config.ts` coverage `include` per phase; ratchet thresholds up as each area clears.
