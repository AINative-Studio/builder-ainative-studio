# Mobile-first passwordless phone login — Part 2 (Builder) design spec

**Date:** 2026-10-06
**Status:** approved, ready for implementation plan
**Supersedes:** nothing — this is Part 2 of `docs/superpowers/specs/2026-10-05-mobile-phone-login-design.md` (Part 1, core-side, is code-complete; see Known risk below)

## Problem

Issue #944: on mobile, serve a phone-number-first signup/login experience — phone in, real texted code, code in, signed in. No email, no password, on that path. Desktop is untouched.

## Known risk — read before starting implementation

Core's `/api/v1/auth/register-phone` and `/api/v1/auth/login-phone` are merged to `core` `main` (PR #8463, closing issue #8459) and the code is correct — read directly, not assumed:
- `users.phone` / `users.phone_verified_at` columns exist (`src/backend/app/models/user.py:176-177`)
- Both endpoints are decorated on the same router as the working `/auth/register`/`/auth/login` (`src/backend/app/api/v1/endpoints/auth.py:2316`, `:2489`)
- Both return the same `TokenResponse` shape (`access_token`, `refresh_token`) that `/register`/`/login` already return

**But as of 2026-10-06T19:20 UTC, production (`api.ainative.studio`) 404s on `GET /api/v1/auth/register-phone`** — the code is not live despite a deploy firing after the merge. Filed `core#8512` to track this.

**Implication for this plan:** build and unit-test this PR against the documented/code-read contract. Do not claim end-to-end verification until `core#8512` closes — the implementation plan must include a final "live integration test" step that stays blocked until then, called out explicitly rather than skipped or faked.

## Scope — this PR only (Part 2)

Two new Builder API routes, one new next-auth provider, mobile-only UI in `Auth.tsx`. Explicitly excludes: core-side work (Part 1, already merged), rate-limit tuning, account-merging, the shared-Text-Cody-number wiring (separate spec, separate issue), anything requiring the live core endpoint.

### 1. API routes

`app/api/build/register-phone/route.ts` and `app/api/build/login-phone/route.ts` — new files, NOT actions bolted onto the existing `app/api/build/register/route.ts` (that file already handles `register`/`resend`/`login-check`/`send-otp`/`verify-otp` as POST-body `action` discriminators for the *existing* email/password + optional-phone-verification flow; mixing the new phone-primary contract into the same action-dispatch would conflate two different identity models in one file). Mirror `register/route.ts`'s established shape:

- Turnstile verification first (fail-closed, same `turnstileEnabled`/`verifyTurnstileToken` calls)
- Body: `{ phone: string, otp_code: string }` for both (E.164; client formats via the existing `lib/build/phone.ts:toE164`)
- `register-phone` additionally forwards `signup_source: 'builder'` + `ext` (gclid/utm from `lib/build/conversions.ts` + `lib/build/meta-capi.ts`, same as `register/route.ts` does) — core's endpoint must honor this identically to `/register` per the Part 1 spec; if it doesn't, that's a core#8512-adjacent follow-up, not something to work around here
- Both proxy directly to core (`${CORE}/api/v1/auth/register-phone` / `/login-phone`) with no Builder-side OTP logic — core owns sending and verifying its own phone OTP (confirmed in Part 1: core has its own `PhoneOtpService`/`phone_otp_codes`, separate from Builder's `lib/build/otp.ts`)
- A third action on one of these routes (or a small third route — decide at implementation time based on which reads cleaner) proxies core's `POST /api/v1/auth/send-phone-otp` so the client can trigger the "send code" step before register/login is attempted
- Returns: `{ ok: true, accessToken, refreshToken, expiresIn }` on success (tokens only — the client hands these to `signIn('phone-login', ...)`, it never stores them itself), `{ ok: false, error, errorCode? }` on failure, same shape discipline as the existing route

### 2. next-auth provider

Add a `phone-login` Credentials provider to `app/(auth)/auth.ts`, modeled directly on the existing `ainative-oauth` provider (same file, already present) — NOT a new password-shaped flow. `ainative-oauth` already solves "adopt an externally-verified token into the session with no password," which is exactly phone-login's shape:

```
Credentials({
  id: 'phone-login',
  credentials: {},
  async authorize(creds: any) {
    if (!creds?.accessToken) return null
    // fetch /v1/auth/me with the token (same as authenticateWithAINative does)
    // to get the real profile id/name — core's register-phone/login-phone
    // return a TokenResponse, not a profile, same as /register and /login do
    const workspace = await resolveDefaultWorkspace(creds.accessToken, { id: null, name: null })
    return {
      id: ...,            // from /v1/auth/me
      email: null,        // phone-only accounts have no email — explicit null, not omitted
      name: ...,           // from /v1/auth/me, falls back to phone-derived label
      type: 'ainative' as const,
      accessToken: creds.accessToken,
      refreshToken: creds.refreshToken,
      expiresIn: creds.expiresIn,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
    }
  },
})
```

Reuses the existing `resolveDefaultWorkspace` helper already in the file — no new workspace-resolution logic. `type: 'ainative'` (not a new `UserType`) since this is still a real core-backed account; nothing downstream (`Session`/`JWT` type declarations) needs to change.

### 3. Mobile detection + UI (`components/build/screens/Auth.tsx`)

CSS-media-query-driven, per the Part 1 spec's own reasoning (avoids SSR hydration mismatch; consistent with the existing `@media (max-width: 760px)` breakpoint already in `app/modernist.css:823`/`:1702` that reshapes this exact screen). Concretely: render BOTH the existing email/password form and a new phone-first form unconditionally in the JSX; `app/modernist.css` adds a rule under the existing 760px breakpoint block that hides the desktop form and shows the phone form (and the reverse above it) — no `navigator.userAgent`, no client-only conditional render.

New phone-first form, phone-only path:
- Phone input (uses `lib/build/phone.ts:toE164` for formatting/validation, already imported in `Auth.tsx`)
- "Send code" button → calls the new send-otp action → code-entry input appears
- Code input + submit → calls `register-phone` (new account, detected via a lightweight core existence check or simply always attempting `login-phone` first and falling back to `register-phone` on a core "no such phone" error — decide the exact detection mechanism at implementation time, since it depends on core's real error shape, not guessable from the Part 1 spec alone) → on success, `signIn('phone-login', { redirect: false, accessToken, refreshToken, expiresIn })`
- **Escape hatch** (required, not optional, per the Part 1 spec's explicit callout): a visible "Use email instead" link/button on the mobile phone-form view that swaps to the existing desktop-style email/password form without a page reload — same screen, same component, just toggles which form is visible via local component state (independent of the CSS breakpoint, which only sets the *default*)

### Testing

- Unit tests for both new routes: Turnstile gate, request shape validation, proxy-to-core call shape, response shape on mocked core success/failure — mirroring the existing test patterns for `register/route.ts`
- Unit test for the `phone-login` provider's `authorize()`: null on missing token, correct session shape on a mocked `/v1/auth/me` response
- Component test for `Auth.tsx`'s new phone-form: send-code → code-entry transition, escape-hatch toggle, form submission calling the right route
- **No live/E2E test against core's real endpoint until core#8512 closes** — call this out explicitly in the implementation plan's final step as blocked, with the exact command to run once it's unblocked (`curl -X POST https://api.ainative.studio/api/v1/auth/register-phone ...` returning something other than 404), rather than silently omitting it

## Non-goals (unchanged from Part 1 spec)

- No desktop behavior change
- No removal/deprecation of email/password accounts
- No account-merging between a phone-only and an email/password account
- No change to the existing optional phone-OTP-as-verification add-on (#734) — stays fully separate
