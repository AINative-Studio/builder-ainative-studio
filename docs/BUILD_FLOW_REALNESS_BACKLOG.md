# Backlog — Builder `/build` Flow Realness Pivot

**PRD:** `docs/PRD_BUILD_FLOW_REALNESS.md`
**Epic:** [#207](https://github.com/AINative-Studio/builder-ainative-studio/issues/207)
**Created:** 2026-08-19

Every item traces to a PRD requirement (R#). "Status" reflects reality, not "UI merged."
An item is **Done** only when its acceptance criterion passes **on production** (PRD R18).

## Legend
- **Done (verified prod):** implemented + re-verified on `builder.ainative.studio`.
- **Done (local only):** implemented + tested locally + deployed, **NOT yet re-verified on prod** → must be prod-verified to truly close.
- **Pending:** not yet implemented.

---

## Backlog items

| ID | Requirement | Title | Depends on | Status | Issue |
|----|-------------|-------|-----------|--------|-------|
| B-01 | R2, R3, R4, R5, R6 | Full autoplay flow — walk entire sequence, no dead-ends, both tracks | — | Done (local only) | #237 |
| B-02 | R15 | Generation overlays (forming/swarm/provisioning) + terminal ribbon | B-01 | Done (local only) | #237 |
| B-03 | R5 | Decision modal — Cody pauses for a real product call | B-01 | Done (local only) | #237 |
| B-04 | R8 | Real artifact generation from idea, tiered by plan (Haiku/Sonnet/Opus 4.5) | — | Done (local only) | #237 |
| B-05 | R9 | Real Preview — actual generated app in the browser frame (sandbox) | B-04 | Done (local only) | #237 |
| B-06 | R10, R11 | Real "Ask Cody" chat + honest Live dashboard metrics + real /intelligence data | B-04 | Done (local only) | #237 |
| B-07 | R17 | Full-bleed Modernist ground — no white gutters | — | Done (verified prod) | #237 |
| B-08 | R7 | Wire Dependency Conflict + Artifact Graph into the flow (built but orphaned) | B-01 | **Done (verified prod)** | #234 ✓ |
| B-09 | R12 | Real Swarm — live agent-swarm run (paid), not overlay | core#6422 | Done (honest degrade; real path live on core#6422 fix) | #232 |
| B-10 | R13 | Real Live business-systems — wire Pipeline/Invoices/Helpdesk/Voice to primitives | enroll | **Done (verified prod)** | #233 ✓ |
| B-11 | R16 | Missing workspace chrome — artifact rail, Index, account chip, artifact IDs/cross-links | B-01 | **Done (verified prod)** | #235 ✓ |
| B-12 | R14 | Persistent live deploy — sandbox Preview → real shareable URL | #213 | Done (verifying prod) | #236 |
| B-13 | R18 | Production verification pass — re-verify B-01..B-06 on builder.ainative.studio | B-01..B-06 | **Done (verified prod)** | #238 ✓ |
| B-14 | R8/R9 | Bug: cody-agent primary 400s on every codegen (masked by Bedrock fallback) — found by #238 | — | Pending | #239 |

## Traceability summary

- **Every PRD requirement R1–R18 maps to at least one backlog item.**
- R1 (Fork/Intake) was completed under the original screen issues (#222); folded into B-01.
- Items B-01..B-07 were **implemented today without a PRD** (process violation). They are
  retro-documented here and traced to a new tracking issue (#237). Per the PRD's R18 they
  are **not truly closed** until re-verified on production (B-13 / #238).
- Items B-08..B-12 map 1:1 to the already-filed issues #234, #232, #233, #235, #236.

## Process correction note

This PRD + backlog were authored **after** B-01..B-07 were coded — a violation of the
AINative workflow (PRD → backlog → issues → execute). The product itself enforces this exact
sequence. Recorded here for honesty; going forward, no `/build` work merges without a
PRD-traced issue, and nothing closes without production verification.
