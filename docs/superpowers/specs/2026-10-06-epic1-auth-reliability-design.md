# Epic 1 — Auth and Reliability — Design Spec

## Source

Derived from "Builder Kickoff Prompt — Claude Code (Oct 2026)" (Google Doc, pasted into this session 2026-10-06), Epic 1 of a 5-epic, 44-story, 171-point backlog. This spec covers Epic 1's 9 stories only; Epics 2–5 get their own specs in wave order.

## Stack conflict (flagged per the doc's own instruction)

The source doc's "AINative engineering standards" section states: *"Backend: Python + FastAPI. Frontend: React. Data: ZeroDB via the AINative ZeroDB MCP server."*

This repo (`builder-ainative-studio`) is **Next.js 15 (App Router, TypeScript), Vitest, ZeroDB via its REST API directly (no MCP server, no Python backend at all)** — confirmed via `CLAUDE.md` and the actual `package.json`/source tree. The doc's own instructions say: *"Where the repo's own conventions conflict with this doc, follow the repo and note the conflict."* This spec and its implementation plan follow the real stack throughout; every story below is scoped in Next.js/TypeScript/Vitest terms, never Python/FastAPI.

## What's already shipped (live-verified, not re-built)

Before drafting this spec, 4 of the 9 Epic 1 stories were checked against the real, live production app — a genuine signed-out browser session, real login, real logout, real reload — not just a code read. All four already work correctly:

| Story | Verified behavior | Shipped via |
|---|---|---|
| **BLD-03** — pre-signup idea attaches to new account | `lib/build/pending-build.ts`: idea + kickoff answers stash to a fixed localStorage key before signup, restored and auto-fired after email verification return. | Existing `#dashboard-ux` auth-wall work |
| **SEP-03** — logout in one click | Real click on "Log out" → lands directly on `screen=landing`, confirmed `session: null` via a real `/api/auth/session` check. No intermediate screen. | Issue #650 |
| **SEP-04** — back to landing from auth screens | Real click on "← Back to site" from the login screen → lands on `screen=landing`. | Issue #651 |
| **SEP-01** — refresh keeps user on My Portfolio | Real reload of `?screen=companies` → identical screen, no redirect to a project dashboard. | Issue #648 |

These four need no further work in this epic. They're listed here only so the plan doesn't re-build something already correct.

## BLD-01 — dropped from this wave

The doc describes BLD-01 ("login works from a fresh browser") as a P0 bug with an unknown root cause, suggesting a check of "auth logs for Oct 5 around 17:55 PT." A real login was attempted live during this spec's own verification pass (fresh signed-out session, real credentials) and **succeeded cleanly in under 3 seconds with no error** — the described bug does not currently reproduce.

**Decision (confirmed with the user):** BLD-01 is dropped from this wave rather than speculatively "fixed." If it recurs, it needs a concrete report (timestamp, account, browser) to investigate against real logs — guessing at a fix for a bug that isn't reproducing risks masking the real cause if it returns.

### A related, real conflict worth surfacing (not resolved here)

A previously **closed** issue, #294 ("Sign in with AINative" OAuth `?error=ainative_exchange_failed`), explicitly concluded the `localhost:8080` redirect in that report came from *the reporting founder's own local dev environment*, not a production misconfiguration, and stated "prod `NEXTAUTH_URL` is correct — no action needed."

This session independently and directly reproduced a **live production** `localhost:8080` redirect on the real "Continue with AINative" OAuth flow (issue #954, still open, root-caused to a stale/contested `oauth_clients.redirect_uris` row on the core side — see core#8484, reopened after core's first "already fixed" claim didn't hold up under a real re-test).

These two findings are not necessarily the same bug, but they share the exact same symptom (`localhost:8080` on this exact OAuth flow) and #294's dismissal is now in direct tension with #954's live evidence. **This needs a human decision, not a silent resolution in this spec**: either #294 was wrong at the time, something regressed since 2026-08-27, or there are genuinely two distinct triggers. Flagging for the user/core team rather than guessing.

## SEP-02 — Delete a company or project: real scope

This is the one story in Epic 1 needing real implementation work.

**Current state** (`lib/build/danger-zone.ts`, confirmed by direct code read): the UI (`components/build/DangerZone.tsx`) already implements the doc's confirmation UX correctly — typing the exact company name/slug is required before "Delete" or "Take offline" will submit, matching the story's acceptance criterion verbatim. The gap is entirely server-side: `applyDangerAction`'s `'delete'` case only does two things —

```typescript
case 'delete': {
  const loopChanged = await setLoopEnabled(req.companyId, req.companyName, req.track, false)
  const lifecycleChanged = await setAppLifecycle(req.slug, 'deleted')
  return { ok: true, action: 'delete', loopChanged, lifecycleChanged }
}
```

This stops the nightly loop and flips a lifecycle flag — a soft delete. The file's own doc comment is explicit and honest about this being deliberate: *"delete → disable the loop AND set app lifecycle 'deleted' (soft delete)."* It does not release any of the real resources a company accumulates. Confirmed via `AppEntry` (`lib/build/app-registry.ts`) and a full-tree grep for any existing deprovisioning call (none found — this is genuinely new work, not a hookup to something that already exists):

| Resource | Field on `AppEntry` | Real backing service |
|---|---|---|
| ZeroDB Instant DB project | `zerodbProjectId` | AINative Instant DB (`POST /api/v1/public/instant-db` at provision time; no corresponding DELETE call exists anywhere in this codebase today) |
| ZeroVoice phone number | `zerovoiceE164` | Twilio, via ZeroVoice's provisioning API |
| Purchased domain | `domain` | Whatever domain registrar/DNS provisioning this repo's `app/api/build/domains` route already uses |
| BYO domain wiring | `byoDomain`, `byoDomainId` | Railway custom-domain API (`byoDomainId` is already a real Railway customDomain id per its own doc comment) |

### Design: real resource release on delete

**Approach:** extend `applyDangerAction`'s `'delete'` case to call a new, best-effort `releaseProvisionedResources(entry: AppEntry)` function that attempts to release each resource the entry actually has (many companies won't have all four — e.g. most won't have a purchased domain). Mirrors this codebase's own established "best-effort + honest" pattern already used in this exact file: each release attempt reports whether it actually succeeded, never throws past the caller, and the overall delete still proceeds (and the lifecycle flag still flips to `'deleted'`) even if a release call fails — a company that's hard to clean up on the backend should still disappear from the founder's view and stop costing them money going forward (loop already stops today), not get stuck in limbo because one deprovisioning call 500'd.

```typescript
export interface ResourceReleaseOutcome {
  zerodbReleased?: boolean
  zerovoiceReleased?: boolean
  domainReleased?: boolean
  byoDomainReleased?: boolean
  errors?: string[]  // human-readable, one per resource that failed — surfaced to an admin/support view, never to the founder's own UI (which only needs ok/not-ok)
}

export async function releaseProvisionedResources(entry: AppEntry): Promise<ResourceReleaseOutcome>
```

Each sub-release (ZeroDB project deletion, Twilio number release, domain release, Railway custom-domain removal) is its own small, independently-testable function in the module that already owns that resource's provisioning logic (not centralized in `danger-zone.ts`, which should stay a thin orchestrator — consistent with this repo's existing file-boundary conventions, e.g. `app-registry.ts` owns lifecycle, `loop-enrollment.ts` owns the loop).

**Open question for the plan, not resolved here:** does releasing a Twilio number or a purchased domain need a second, even-stronger confirmation (these can have real-world consequences — e.g. a released phone number could be reassigned to someone else by Twilio, a released domain enters a redemption/drop window) beyond the existing type-the-name confirm? Flagging as a question for the implementation plan to answer explicitly, not silently deciding either way here.

## Stories not otherwise covered

**BLD-02a/b/c/d** (Twilio escalation, email OTP fallback, "text didn't arrive" messaging, team alerting): BLD-02b and BLD-02c's user-facing core — a timeout-driven "didn't get it?" message with a recovery path — already shipped this session as issues #950/#951 (a 45-second countdown on the OTP screen, then Resend/Skip). This spec treats that as the real implementation of BLD-02c's acceptance criterion in spirit (the doc specifies a Twilio-status-webhook-driven detection within 30 seconds; the shipped version is a client-side timeout at 45 seconds — a faster, webhook-driven version is a real, smaller refinement, not unstarted work). BLD-02b (an actual email-code alternative channel, not just "give up on phone verification") and BLD-02d (on-call alerting on delivery errors) are genuinely new, small, and not yet built. BLD-02a is an ops/support task (a Twilio support case), not engineering work — out of scope for this spec entirely.

These three remaining pieces (02b real email channel, 02c webhook-driven speed-up, 02d alerting) are small enough to fold into the same implementation plan as SEP-02 rather than warranting their own spec section — real work, but not architecturally novel given #950/#951 already established the pattern.

## Summary of real scope for the implementation plan

1. **SEP-02**: `releaseProvisionedResources()` + wiring into `applyDangerAction`'s delete case, with real sub-releases for ZeroDB, ZeroVoice, purchased domains, and BYO domain wiring.
2. **BLD-02b**: real email-code fallback channel (today's "Skip for now" just proceeds unverified — this adds an actual alternative verification path).
3. **BLD-02c refinement**: wire Twilio's real delivery-status webhook so a known-undelivered code surfaces to the user faster than the existing 45s timeout, when Twilio actually reports failure (vs. timing out blind).
4. **BLD-02d**: on-call alerting when SMS delivery errors occur.

Everything else in Epic 1 (BLD-01, BLD-03, SEP-01, SEP-03, SEP-04) requires no further implementation — either already shipped and live-verified, or dropped per the "doesn't currently reproduce" finding above.
