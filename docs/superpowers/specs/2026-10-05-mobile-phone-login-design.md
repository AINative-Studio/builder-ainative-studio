# Mobile-first passwordless phone login — design spec

**Date:** 2026-10-05
**Status:** draft, pending approval
**Supersedes the "core-identity-model" open question in issue #938**

## Problem

Today, every founder — on any device — sees the same signup/login form: email + password, with an *optional* phone-number add-on that sends a real OTP (#938, Twilio direct send, shipped) purely to mark `phoneVerified: true` on an otherwise email/password account. There is no way to actually log in or register using only a phone number.

The ask: on a mobile device, detect that and serve a phone-number-first registration/login experience instead — founder enters their phone, gets a real texted code, enters it, and is signed in. No password, ever, for that path.

## Real constraint, confirmed against core's actual code (2026-10-05)

`core`'s `/api/v1/auth/register` and `/api/v1/auth/login` are hard-required email+password contracts:
- `UserCreate` (`src/backend/app/zerodb/schemas/auth.py:16`): `email: EmailStr` (required, no default), `password: str` (required)
- `/login` (`src/backend/app/api/v1/endpoints/auth.py:2089`) looks up by `get_email_identifier()` (email or username) and verifies a `password_hash` — there is no non-password auth path
- The `users` table has **no phone column at all** (confirmed via direct production schema query) — this is genuinely greenfield, not a gap in an existing field

Per explicit product direction, this spec does NOT route around that with a synthetic-email workaround — it specs the real fix: giving `core` a native phone-identity capability.

## Scope — two repos, sequenced

This is two linked pieces of work. **Builder's mobile UI is blocked on core's phone-identity API existing** — they cannot ship in parallel as independent PRs; core's piece must land and deploy first.

### Part 1 — `core`: native phone identity (new issue on `AINative-Studio/core`)

- **Schema**: add `users.phone` (`VARCHAR`, nullable, unique index — nullable because existing/email-only accounts have none) and `users.phone_verified_at` (nullable timestamp).
- **`POST /api/v1/auth/register-phone`** (new endpoint, parallel to `/register`): body `{ phone: E.164 string, otp_code: string }`. Requires the OTP to have already been sent+verified via a real SMS provider (core already owns the real Twilio account — Builder's #938 work copied credentials FROM core; core should use its own, not duplicate the OTP-send logic Builder built). Creates a user row with `phone` set, `email` NULL, no `password_hash`. Returns the same `TokenResponse` shape `/register` does (access + refresh JWT), so downstream session handling is unchanged.
- **`POST /api/v1/auth/login-phone`** (new endpoint, parallel to `/login`): body `{ phone: E.164 string, otp_code: string }`. Looks up by `phone`, verifies the OTP (not a password), issues the same JWT pair `/login` does.
- **OTP send/verify**: core needs its own real OTP generation+send+verify (NOT a reuse of Builder's `lib/build/otp.ts`, which is Builder-local ZeroDB state — core needs this in its own data layer so `login-phone` can verify a code sent moments earlier from a possibly-different device/session). This is genuinely new backend work on core's side, not a port.
- **Email-optional account completeness**: audit what currently assumes `users.email IS NOT NULL` (password reset flows, email verification, Stripe receipt emails, the `get_user_by_email` helper itself) and decide, per touch point, whether it: (a) is skipped entirely for a phone-only account, (b) prompts the founder to add an email later (e.g. before a paid upgrade, where a receipt needs somewhere to go), or (c) needs its own phone-aware equivalent. This audit is real, necessary work — do not guess at a blanket answer in this spec; it needs core's own team to walk their codebase's real email assumptions.
- **Billing/Stripe implication**: Stripe checkout needs a contact email at least for the receipt — a phone-only account attempting to upgrade to a paid plan needs an "add your email" step inserted into that flow specifically, not a blanket requirement at signup.

### Part 2 — `builder`: mobile detection + phone-first UI (this repo, gated on Part 1 shipping)

- **Mobile detection**: `components/build/screens/Auth.tsx` needs to know it's being viewed on a mobile device. Decide between a CSS-media-query-driven conditional render (two markup variants, one shown per breakpoint via CSS, avoids any JS/SSR hydration mismatch) vs. a client-side `navigator.userAgent`/viewport check (simpler conditional JSX, real hydration-mismatch risk since server-rendered HTML can't know the real client viewport). Recommend the CSS-driven approach for this reason, consistent with how `modernist.css`'s existing `@media (max-width: 760px)` breakpoint already reshapes this exact screen for #940/#941/#942's fixes earlier this session.
- **Mobile signup/login markup**: phone number field only, "Send code" → real OTP → code entry → submit. No email, no password fields rendered at all in this path. Desktop is completely unchanged (still email/password, with the existing optional phone-OTP add-on from #734 untouched).
- **New Builder-side API routes**: `app/api/build/register-phone/route.ts` and a phone-login equivalent, calling core's new `/register-phone`/`/login-phone` once Part 1 ships — mirroring the existing `app/api/build/register/route.ts` pattern (Turnstile verification first, same fail-closed shape, same `signup_source: 'builder'` attribution still sent since core's new endpoints should accept and honor it identically to `/register`).
- **Session/next-auth integration**: `app/(auth)/auth.ts`'s `credentials` provider is email/password-shaped — a phone-login success needs its own next-auth provider (or a documented, deliberate decision to set the session cookie directly from the JWT core returns, bypassing next-auth's `signIn()` call entirely, the way `/api/build/register`'s callers already do via a subsequent `signIn('credentials', ...)` — but phone users have no password to pass there). This is a real, non-trivial integration point — flag for implementation-time investigation, not hand-waved here.
- **Existing phone-OTP-as-verification flow (#734) stays**: this spec adds a NEW, parallel phone-as-primary-identity path; it does not replace or merge with the existing optional add-on verification that email/password signups already use.

## Relationship to the shared Text-Cody number spec (unified, not independent)

Originally scoped as two unrelated features sharing only Twilio OTP-send mechanics. Per explicit product direction (2026-10-05): **a founder's phone-login number (this spec) IS their one number of record for all Cody SMS communication** — the same number used to sign in is the same number the shared-937 conversation flow (`2026-10-05-shared-cody-number-design.md`) looks up against. Concretely:

- `core`'s new `users.phone` column (Part 1 above) becomes the single source of truth for "what number does this founder use."
- The shared-number spec's originally-proposed `findFounderByPhone()` (querying Builder's own `builder_founder_phones` ZeroDB table) should instead query/derive from `core`'s `users.phone` for any founder who registered via phone-login. `builder_founder_phones` (Builder's own ZeroDB table, #734) still exists for the OTHER case — an email/password founder who added an optional verified phone via the existing add-on flow, never having a phone-identity core account at all.
- Net effect: `findFounderByPhone(e164)` (shared-number spec) needs to check BOTH sources — core's `users.phone` first (phone-identity accounts), falling back to Builder's own `builder_founder_phones` table (email/password accounts with an optional verified phone) — rather than only the latter as originally scoped. Update `2026-10-05-shared-cody-number-design.md`'s section 1 accordingly before implementing either spec.
- This also means a phone-login founder gets the shared-number conversation capability "for free," with no separate add-on step — they're already phone-verified by construction. Whether this is gated by the same paid-tier check the shared-number spec requires needs the same `isPaidTier` call regardless of which identity path got them there.

## Non-goals

- This does not change desktop behavior at all.
- This does not remove or deprecate email/password accounts — phone-only is an additional identity type, not a replacement.
- This does not attempt to merge/link a phone-only account with an existing email/password account for the same person (account-merging is its own real feature with its own edge cases — explicitly out of scope here).

## Open questions for implementation time

1. Exact `core` migration plan for the nullable `email`/`password_hash` columns — are they already nullable, or does this require a schema migration? (Not checked in this spec — first real step of the core-side issue.)
2. Whether `login-phone`'s OTP should be time-boxed differently than registration's (a returning user logging in daily via OTP is a different threat/UX model than a one-time signup verification).
3. Real UX for "I'm on mobile but want to use email/password anyway" — an escape hatch out of the phone-first flow, not optional for a stellar mobile experience per the founder's own stated bar.
4. Rate-limiting strategy for `login-phone` specifically (every login attempt sends a real, billed SMS — a different cost profile than registration's one-time send).
