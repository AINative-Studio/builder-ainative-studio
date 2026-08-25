# Token Economics: idea → clickable prototype — cost model & freemium ladder

**Date:** 2026-08-25 · **Purpose:** quantify what it costs AINative to take one user from "submit an idea" to a clickable prototype on `/build/{slug}`, and use that to set the freemium/paid ladder. Grounded in the actual generation pipeline (`lib/build/state.ts`, `app/api/build/artifact/route.ts`, `app/api/chat-ws/route.ts`, `lib/build/tier-models.ts`).

## What actually runs, idea → prototype

The **App track** (`APP_VIEWS`) is 13 views; 10 are LLM-generated prose artifacts, the last 3 (`swarm`, `infra`, `preview`) are UI/build steps. The clickable app itself is one codegen call. So per prototype:

| Step | LLM calls | max_tokens/call | Notes |
|---|---|---|---|
| Prose artifacts (brief, prd, comp, dataModel, memoryPolicy, agentDef, codingStandards, apiSpec, backlog, sprintPlan) | 10 | 1,600 | `/api/build/artifact`, one per view |
| Codegen (the clickable prototype) | 1–2 | 8,192–16,000 | `/api/chat-ws` |
| Brand naming (Intake) | 1 | small | `/api/build/brand` |

### Token + cost estimate (per single prototype)

Conservative averages (input = system prompt + idea + prior artifacts; output ≈ max_tokens actually used):

| | Input tokens | Output tokens |
|---|---|---|
| 10 artifacts | ~80,000 (≈8K each) | ~16,000 (≈1.6K each) |
| 1–2 codegen | ~5,000 | ~16,000 |
| brand | ~1,000 | ~500 |
| **Total** | **~86,000** | **~32,500** |

Rounded working figure: **~85K in / ~35K out per prototype.**

### COGS by model tier (Bedrock list rates)

| Tier (model) | $/M in | $/M out | **Cost per prototype** |
|---|---|---|---|
| **Free / Starter — Haiku 4.5** | ~$1 | ~$5 | **~$0.085 + ~$0.175 ≈ $0.26–$0.33** |
| **Pro — Sonnet 4.5** | ~$3 | ~$15 | **~$0.26 + ~$0.53 ≈ $0.79–$0.98** |
| **Enterprise — Opus 4.5** | ~$15 | ~$75 | **~$1.3 + ~$2.6 ≈ $3.90** |

**Headline: a full idea→prototype build costs ≈ $0.33 on Haiku, ≈ $1.00 on Sonnet.**

## The freemium question, answered

> "Can we do a Hobbyist account with 1000 requests as an upgrade, or do we need a $20 entry to see value? How many free credits to get them to sign up and claim?"

**1 build ≈ 12 LLM calls ("requests").** So:

- **1000 requests ≈ ~80 Haiku builds ≈ ~$27 of COGS.** Too expensive to give away free — but a *reasonable paid* allowance.
- **To just "see value" (reach the clickable prototype): 1 build ≈ $0.33.** You do **not** need a $20 wall to show value; one Haiku build is ~33¢.

### The decided ladder

| Tier | Price | Model | Builds | ~COGS at cap | Rationale |
|---|---|---|---|---|---|
| **Free** | $0 | Haiku | **3 builds** | ~$1 | Cheap enough to give away; 3 builds lets them iterate to an "aha" before the wall. Gated behind **signup** (auth wall) so we capture the email before spending tokens. |
| **Starter** | **$20** | Haiku | ~80 (1000 req) | ~$27 | Price-sensitive entry above free. COGS ceiling ~$27 at *full* utilization; real users build far fewer, so healthy margin. Bridges the gap to Pro's $49. |
| **Pro** | $49 | Sonnet | unlimited* | token-metered | Real generation. *Unlimited builds, metered by the 1M-token allotment. |
| **Business** | $149 | Sonnet | unlimited* | token-metered | + nightly loop, pipeline/invoicing/helpdesk/voice. |
| **Enterprise** | $999 | Opus | unlimited* | token-metered | + real agent-swarm builds, SSO. |

\* "Unlimited builds" = no per-build counter; usage bounded by the plan's monthly token allotment.

### Why the auth wall matters economically

Before this change there was **no forced registration** — an anonymous visitor could trigger a full build (~$0.33 of tokens) with no email captured. The auth wall (submit idea → register → verify email → dashboard → view prototype) means **every token we spend is on a registered lead.** That converts spend into a captured email + a claimable asset, which is the entire point of a freemium funnel.

## What shipped alongside this doc

- **Auth wall** (`Intake.tsx` + `DEFER_BUILD`/`pendingBuild` in `state.ts` + `Auth.afterAuth`): anonymous idea-submit → signup → "check your email" → verify → back → deferred build fires. Pending build persisted (`lib/build/pending-build.ts`) so it survives the email round-trip.
- **Build-credit enforcement** (`lib/build/build-credits.ts` + `/api/build/credits`): counts builds per owner in a ZeroDB table (`builder_build_credits`); Free=3, Starter=~80, paid=unlimited. **Fails open** on any metering outage (never hard-blocks a founder). Client gates at build start (`Intake` + `afterAuth`) → 402 routes to pricing.
- **Starter tier** added to `Pricing.tsx` + `pricing-tiers.ts` ($20, Haiku, ~80 builds).

## Known follow-ups / dependencies

1. **Stripe price for Starter** — `priceId` is a TODO in `Pricing.tsx` (checkout falls through to the build-out until the $20/mo Stripe price is created). Same pattern as the existing yearly-price TODOs.
2. **Tier-name collision (core):** the word "starter" is a LEGACY alias for the free tier in `lib/ainative/plan.ts` `normalizeTier` (maps starter→hobbyist→Haiku). The new PAID Starter needs core to emit a **distinct plan id** so `getPlanStatus` resolves it to a `starter` tier (which `buildLimitForTier` already handles). Until then a paid-Starter subscriber resolves to `hobbyist` — which still gets the correct Haiku model, only the build *limit* would default to the free 3 rather than 80. **Action:** core issue to assign paid Starter a unique plan id.
3. **Business price mismatch** — `pricing-tiers.ts` says $199, `Pricing.tsx` says $149. Not reconciled here (out of scope); flagged for a pricing decision.
4. **Token estimates are list-rate + conservative** — actual input tokens grow with `prior` artifact context accumulation across the 10-view sequence; measure real usage from `preview-store` token tracking to refine COGS.
