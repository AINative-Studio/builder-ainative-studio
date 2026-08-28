# Re-engagement / Winback Email — 2026-08-27

**Tracking issue:** #344. **Sender:** Resend (we have an account).

## Source
Replit winback email (screenshot 2026-08-27). Verbatim structure:
> Hi Toby — Remember **Team OKR Tracker**? You were onto something great. Good news — you get fresh credits every day on your Starter plan, and they're ready to use right now. **[Jump back in →]** Your daily credits refresh automatically, so there's always room to experiment, iterate, and build. No pressure, just possibilities. — The Replit team. P.S. When you're ready to share what you've built, publishing is completely free. [Here's how →]

## Why it converts (the pattern to copy)
1. **Personalized with the PROJECT NAME** ("Remember Team OKR Tracker?") — not a generic blast.
2. **Concrete unblock** — credits refreshed and ready *right now* (removes the "I'm out of runway" mental block).
3. **Single CTA** deep-linking back into the build.
4. **Zero-pressure tone** — "no pressure, just possibilities."
5. **P.S. seeds the next milestone** — publishing is free (the share/publish moment).

## Our-stack mapping
| Replit element | Our equivalent |
|---|---|
| Sender | **Resend** — new `lib/growth/winback-email.ts` + template in Cody's voice (◇, first-person, Modernist plain style; no hype/exclamations) |
| Audience | Owners in app-registry (`ownerEmail`) with a registered app and no build/preview/chat activity in N days (7 default) — from `builder_build_credits` events + chat-store |
| Project name | Company name + tagline from the registry |
| "Credits refreshed" | Free-tier build-allowance state (`build-credits`); ecosystem-bonus mention when earned |
| CTA deep link | `/build?screen=companies` or `?screen=live&company={slug}` (durable) |
| P.S. "publishing is free" | Claim-your-subdomain / share-your-app |
| Trigger | Nightly loop cron **(prereq: `/api/cron/*` is middleware-gated — fix the allowlist per codebase audit finding #9)** or a Railway cron |
| Idempotency | One winback per owner per 30d, logged to ZeroDB (`builder_emails`) for suppression + measurement |
| Measurement | UTM on the CTA (existing attribution capture); Resend open/click webhooks later |

## Acceptance
A dormant owner (7d inactive, has a registered app) receives ONE personalized email naming their company, with a working deep link back to their dashboard; suppressed for 30d thereafter; unsubscribe honored; no email for owners with zero registered apps.

## Prerequisite (blocker)
The cron path (`/api/cron/*`) is currently 401'd by the middleware session gate before its own auth runs (codebase audit 2026-08-27, dormant finding #9). That allowlist fix must land before any scheduled winback can fire.
