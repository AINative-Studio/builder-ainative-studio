# Sprint Plan — Greg Rose Customer Interview (Builder)

**Source:** `core/docs/customer-feedback/greg-rose-builder-interview-2026-08-25-*` (4 transcripts + ANALYSIS.md)
**Customer:** Greg Rose — ex-DevRel, now prosumer vibe coder (walking ICP spec)
**Created:** 2026-08-25
**Theme:** *Reach the value moment before the paywall, and make the moat visible.*

> One customer, but exceptionally high-signal (he ran developer programs professionally). Every item below traces to a direct quote in the ANALYSIS.md. Priority reflects "does this block a user from reaching the wow moment and converting."

---

## The problem, in one line

Greg built an app, was asked for a credit card **before ever seeing a preview**, never saw his credits, and could not discover **what the platform can even do** — so the moat (built-in CRM/ERP/invoicing/email/auth, no third-party keys) stayed invisible and he never converted. Replit won his engagement by **educating him** and **showing working functionality**.

---

## Sprints

### Sprint 1 — "See it before you pay" (P0, conversion-blocking)
Goal: a first-time user reaches a working, visible prototype **before** any hard paywall, and can see their credits.

| ID | Item | Type | Bug/Feat refs |
|----|------|------|---------------|
| GR-01 | Real preview of the built app before the paywall — user can see & interact ("kick the tires") | bug, P0 | B1 |
| GR-02 | Move the credit-card prompt to AFTER the preview/value moment; never card-gate before first working artifact is visible | bug, P0 | B2, I5 |
| GR-03 | Credits/usage visible in the Builder + verify AINative-account credits actually transfer to Builder (fix if not) | bug, P0 | B3 |

### Sprint 2 — "Make the moat visible" (P0/P1, strategic unlock)
Goal: Cody proactively communicates what the platform can do and the built-in-primitives value prop.

| ID | Item | Type | refs |
|----|------|------|------|
| GR-04 | "What can I build?" capability catalog — plain-English, first-class surface Cody uses to educate (NOT the API reference) | product-enhancement, new-feature, P0 | F1, I2, I3 |
| GR-05 | Surface built-in primitives in Cody: "you already have CRM/invoicing/email/auth — no extra key or cost," name the third-party it replaces + $ saved | product-enhancement, insight, P0 | F2, I1 |
| GR-06 | Plain-English product descriptions + "replaces X" mapping (ZeroPipeline → "CRM that finds leads & runs outreach — replaces Keap/Salesforce") | product-enhancement, P1 | F3 |

### Sprint 3 — "Discovery that's correct & credible" (P1)
Goal: capability discovery returns the right thing and recommendations are trustworthy.

| ID | Item | Type | refs |
|----|------|------|------|
| GR-07 | Fix capability-discovery surfacing the wrong page (API Reference) instead of a capabilities overview | bug, P1 | B6 |
| GR-08 | Fix ZeroDB semantic search not returning results in generated apps | bug, P1 | B7 |
| GR-09 | Educational, tool-agnostic recommendations (recommend genuinely-best tools like Replit did with Loops), lean AINative where it truly fits — "not an AINative commercial" | product-enhancement, P1 | F5, I3 |

### Sprint 4 — "Onboarding for the lowest common denominator" (P1/P2)
Goal: first-run spells out the obvious, and users can self-unblock.

| ID | Item | Type | refs |
|----|------|------|------|
| GR-10 | "Turn on the computer" first-run — make the very first action unmissable; aim at the lowest common denominator | product-enhancement, ux, P1 | F6 |
| GR-11 | MVP-first build flow: deliver a working prototype first, then "here's the full PRD/sprint → this sprint costs N tokens" | product-enhancement, P1 | F3b |
| GR-12 | In-context "I'm stuck" jump-to-answer — semantic search across docs AND tutorial videos, jump to the exact spot | new-feature, P2 | F4 |
| GR-13 | Legacy-account + intermittent login fix (no permanent API key on legacy free accounts; "logging fail" on dashboard) | bug, P2 | B4, B5 |

### Sprint 5 — "Polish & pricing" (P2)
| ID | Item | Type | refs |
|----|------|------|------|
| GR-14 | Upload-your-own photos/assets in preview/build (not just AI-generated) | bug, ux, P2 | B8 |
| GR-15 | Ecosystem-aligned credits: reward staying in-ecosystem with more runway before the hard paywall; pair with a $5-trial pricing experiment | product-enhancement, insight, P2 | F7, I4, I5 |

---

## Key strategic insights (carry into product strategy, not just sprints)

- **I1 — The moat is invisible.** Communicating "Replit price, everything included" is the single highest-leverage change. (GR-04/05/06)
- **I2 — Functionality > aesthetics for this ICP.** Lead with capability.
- **I4 — Pricing: $5 = no-brainer, $49 = friction** for a prosumer. Worth an A/B.
- **I6 — Churn mirror:** Greg's *own* product loses users who "try it and go eh" for the same reason — no fast value moment. Universal lesson: **time-to-wow is the metric.**
- **I7 — The prosumer ("hacker who makes dev money") is the ICP** — and Greg is a design-partner candidate ("I'd love to come back").

---

*Backlog: `docs/growth/BACKLOG_GREG_ROSE_FEEDBACK_2026-08-25.md`. Issues filed in AINative-Studio/builder-ainative-studio.*
