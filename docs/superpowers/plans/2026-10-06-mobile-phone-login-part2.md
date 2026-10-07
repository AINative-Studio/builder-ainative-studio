# Mobile-first passwordless phone login — Part 2 (Builder) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mobile-only, phone-number-first signup/login path to Builder's Auth screen, backed by two new API routes that proxy core's phone-identity endpoints and a new next-auth provider that adopts the resulting session — with no password or email ever required on that path.

**Architecture:** Two new, independent Next.js route handlers (`register-phone`, `login-phone`) mirror the existing `app/api/build/register/route.ts` Turnstile-gated proxy pattern, returning raw tokens only. A new `phone-login` Credentials provider in `app/(auth)/auth.ts`, modeled on the existing `ainative-oauth` provider, adopts those tokens into a session with no password check. `Auth.tsx` renders a second, independent phone-form block (not a new `mode` value) alongside the existing email/password form; a CSS media query under the existing `@media (max-width: 760px)` breakpoint in `app/modernist.css` decides which is visible by default, with a client-side toggle as the required escape hatch in both directions.

**Tech Stack:** Next.js App Router route handlers, next-auth v5 Credentials provider, Vitest (`@vitest-environment node` for routes/provider, jsdom for the component), existing `lib/build/phone.ts:toE164`, `lib/turnstile.ts`.

**Spec:** `docs/superpowers/specs/2026-10-06-mobile-phone-login-part2-design.md` (and its Part 1 parent, `docs/superpowers/specs/2026-10-05-mobile-phone-login-design.md`)

## Global Constraints

- No desktop behavior change — the existing email/password form, its CSS, and its `submit()` logic in `Auth.tsx` are untouched except for one JSX insertion point.
- No change to the existing optional phone-OTP-as-verification add-on (#734, `phone`/`verifyPhone`/`phoneVerified` state already in `Auth.tsx`) — this is a fully separate, parallel path with its own state.
- New routes proxy core only — no Builder-side OTP generation/storage for this path (that's `lib/build/otp.ts`, which belongs to #734 and must not be reused here).
- Mobile detection is CSS-only (media query), never `navigator.userAgent` or any client-only viewport check — avoids SSR hydration mismatch, per the Part 1 spec's explicit reasoning.
- The escape hatch between phone-first and email/password forms is required in both directions, not optional.
- Do not claim or test live integration against core's real `/register-phone`/`/login-phone` endpoints — they currently 404 in production (core#8512, open, owned by another team). Every test in this plan mocks `fetch`; no task calls the real network.
- `email: null` (explicit), never omitted, on a phone-only session — downstream code that reads `session.user.email` must see an explicit absence, not `undefined` from a missing key.

## Review Focus

- A submitted phone number that fails `toE164` validation (too short, non-numeric garbage, empty string after trim) — the route must reject with 400 before ever calling core, matching `handleSendOtp`'s existing `invalid_phone` behavior in `register/route.ts`.
- Core returning a non-2xx from `/login-phone` because no account exists yet for that phone (the "new number, should this be register or login" case the spec leaves open) — the UI must not show a raw/generic error; it must detect this specific core response and route the founder into the registration path instead of dead-ending.
- Turnstile verification failing on the phone-first path — same fail-closed contract as the email/password path (`register/route.ts`'s existing Turnstile gate), not an accidental bypass because this is a "new" route.
- A founder on mobile who wants email/password instead (no phone, shared device, etc.) — the escape hatch must be reachable and must fully swap the visible form, not just show a link that does nothing.
- `signIn('phone-login', ...)` failing (core issued tokens but `/v1/auth/me` lookup — reused from the existing `authenticateWithAINative` pattern — fails, or returns malformed data) — the provider's `authorize()` must return `null` cleanly (never throw), and the UI must show a real error message, not hang on `busy: true` forever.

---

## File Structure

| File | Responsibility |
|---|---|
| `app/api/build/register-phone/route.ts` | New. `POST` handles `action: 'send-otp'` (proxies core's `/auth/send-phone-otp`) and the default register action (proxies `/auth/register-phone`), Turnstile-gated, same response shape discipline as `register/route.ts`. |
| `app/api/build/login-phone/route.ts` | New. `POST`, default action only, proxies core's `/auth/login-phone`. No Turnstile gate (mirrors `register/route.ts`'s own login-check path, which also isn't Turnstile-gated — login isn't the bot-signup surface Turnstile protects). |
| `app/(auth)/auth.ts` | Modify. Add the `phone-login` Credentials provider after the existing `ainative-oauth` provider (after line 228's `}),`, before the providers array's closing `],`). |
| `components/build/screens/Auth.tsx` | Modify. Add phone-first form state + a new JSX block (`m-auth-phone-form`), sibling to the existing email/password block, with its own submit handler. |
| `app/modernist.css` | Modify. Under the existing `@media (max-width: 760px)` block (starts line 1702), add rules toggling `.m-auth-phone-form`/`.m-auth-fields` visibility by default; add a non-media override class pair (`.m-auth-force-email`/`.m-auth-force-phone`) for the escape-hatch toggle to override the media query regardless of viewport. |
| `__tests__/api/register-phone-route.test.ts` | New. Route handler tests. |
| `__tests__/api/login-phone-route.test.ts` | New. Route handler tests. |
| `__tests__/lib/auth/phone-login-provider.test.ts` | New. Provider `authorize()` tests. |
| `__tests__/components/build/Auth-phone-form.test.tsx` | New. Component tests for the phone-first form + escape hatch. |

---

## Task 1: `register-phone` route — send-otp action

**Files:**
- Create: `app/api/build/register-phone/route.ts`
- Test: `__tests__/api/register-phone-route.test.ts`

**Interfaces:**
- Consumes: `toE164` from `@/lib/build/phone` (existing, signature `(raw: string) => string | null`), `turnstileEnabled`/`verifyTurnstileToken` from `@/lib/turnstile` (existing).
- Produces: `POST` handler at `/api/build/register-phone`. Body `{ action: 'send-otp', phone: string }` → `{ ok: true } | { ok: false, reason: string }`. Later tasks (3, 4) depend on this exact action-dispatch shape existing in the same file as the register action.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/api/register-phone-route.test.ts
/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

function req(body: unknown, ip = '1.2.3.4') {
  return {
    json: async () => body,
    headers: {
      get: (k: string) => {
        const key = k.toLowerCase()
        if (key === 'x-forwarded-for') return ip
        return null
      },
    },
  } as any
}

describe('POST /api/build/register-phone — send-otp action', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('rejects an invalid phone before calling core', async () => {
    const { POST } = await import('@/app/api/build/register-phone/route')
    const res = await POST(req({ action: 'send-otp', phone: 'not-a-phone' }))
    const d = await res.json()
    expect(res.status).toBe(400)
    expect(d.ok).toBe(false)
    expect(d.reason).toBe('invalid_phone')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('proxies a valid phone to core send-phone-otp', async () => {
    const { POST } = await import('@/app/api/build/register-phone/route')
    const res = await POST(req({ action: 'send-otp', phone: '5125551234' }))
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/auth/send-phone-otp'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ phone: '+15125551234' }),
      }),
    )
  })

  it('surfaces a core failure as ok:false without leaking the raw core body', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({ detail: 'rate limited internally' }) })
    const { POST } = await import('@/app/api/build/register-phone/route')
    const res = await POST(req({ action: 'send-otp', phone: '5125551234' }))
    const d = await res.json()
    expect(res.status).toBe(429)
    expect(d.ok).toBe(false)
    expect(d.reason).toBe('send_failed')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/api/register-phone-route.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/build/register-phone/route'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// app/api/build/register-phone/route.ts
/**
 * POST /api/build/register-phone (#944 Part 2) — mobile-first, passwordless
 * phone registration. Proxies core's native phone-identity endpoints
 * (core#8463/#8459); no Builder-side OTP logic here — core owns its own
 * send/verify (separate from lib/build/otp.ts's #734 add-on flow).
 *
 * As of 2026-10-06, core's /auth/register-phone and /auth/send-phone-otp
 * are merged but NOT live in production (core#8512, tracked separately,
 * owned by another team) — this route is built and tested against the
 * documented/code-read contract; do not assume it works end-to-end until
 * core#8512 closes.
 *
 * Body (send-otp):  { action: 'send-otp', phone: string }
 * Body (register):  { phone: string, otp_code: string, turnstileToken? }
 * Returns (send-otp): { ok: true } | { ok: false, reason: string }
 * Returns (register): { ok: true, accessToken, refreshToken, expiresIn } | { ok: false, error: string }
 */
import { NextRequest } from 'next/server'
import { toE164 } from '@/lib/build/phone'
import { turnstileEnabled, verifyTurnstileToken } from '@/lib/turnstile'

export const runtime = 'nodejs'

const CORE = process.env.AINATIVE_API_URL || process.env.AINATIVE_API_BASE_URL || 'https://api.ainative.studio'

async function handleSendOtp(rawPhone: string) {
  const phone = toE164(rawPhone)
  if (!phone) return Response.json({ ok: false, reason: 'invalid_phone' }, { status: 400 })

  try {
    const res = await fetch(`${CORE}/api/v1/auth/send-phone-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
      signal: AbortSignal.timeout(25000),
    })
    if (!res.ok) {
      return Response.json({ ok: false, reason: 'send_failed' }, { status: res.status })
    }
    return Response.json({ ok: true })
  } catch (e: any) {
    return Response.json({ ok: false, reason: 'network_error' }, { status: 502 })
  }
}

export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => null)

  if (b?.action === 'send-otp') return handleSendOtp(String(b?.phone || ''))

  return Response.json({ ok: false, error: 'not_implemented' }, { status: 501 })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/api/register-phone-route.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add app/api/build/register-phone/route.ts __tests__/api/register-phone-route.test.ts
git commit -m "feat(auth): register-phone route — send-otp action (#944)"
```

---

## Task 2: `register-phone` route — register action (Turnstile-gated)

**Files:**
- Modify: `app/api/build/register-phone/route.ts`
- Test: `__tests__/api/register-phone-route.test.ts`

**Interfaces:**
- Consumes: same as Task 1, plus the `handleSendOtp` function already in the file.
- Produces: the default (no `action`) POST path returns `{ ok: true, accessToken: string, refreshToken: string, expiresIn: number } | { ok: false, error: string }`. Task 5 (next-auth provider) and Task 7 (Auth.tsx) consume this exact response shape.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/api/register-phone-route.test.ts`:

```typescript
describe('POST /api/build/register-phone — register action', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 201,
      json: async () => ({ access_token: 'tok-abc', refresh_token: 'ref-abc', expires_in: 3600 }),
    })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('rejects an invalid phone before calling core', async () => {
    const { POST } = await import('@/app/api/build/register-phone/route')
    const res = await POST(req({ phone: 'bad', otp_code: '123456' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_phone')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a missing otp_code before calling core', async () => {
    const { POST } = await import('@/app/api/build/register-phone/route')
    const res = await POST(req({ phone: '5125551234', otp_code: '' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_request')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('proxies to core register-phone and returns raw tokens on success', async () => {
    const { POST } = await import('@/app/api/build/register-phone/route')
    const res = await POST(req({ phone: '5125551234', otp_code: '123456' }))
    const d = await res.json()
    expect(res.status).toBe(200)
    expect(d).toEqual({ ok: true, accessToken: 'tok-abc', refreshToken: 'ref-abc', expiresIn: 3600 })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/auth/register-phone'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ phone: '+15125551234', otp_code: '123456' }),
      }),
    )
  })

  it('surfaces a core registration failure cleanly', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({ detail: 'phone already registered' }) })
    const { POST } = await import('@/app/api/build/register-phone/route')
    const res = await POST(req({ phone: '5125551234', otp_code: '123456' }))
    const d = await res.json()
    expect(res.status).toBe(409)
    expect(d.ok).toBe(false)
    expect(d.error).toBe('phone already registered')
  })

  it('gates on Turnstile when enabled, failing closed before calling core', async () => {
    vi.doMock('@/lib/turnstile', () => ({
      turnstileEnabled: () => true,
      verifyTurnstileToken: vi.fn().mockResolvedValue({ success: false }),
    }))
    vi.resetModules()
    const { POST } = await import('@/app/api/build/register-phone/route')
    const res = await POST(req({ phone: '5125551234', otp_code: '123456', turnstileToken: 'bad' }))
    const d = await res.json()
    expect(res.status).toBe(400)
    expect(d.ok).toBe(false)
    expect(d.error).toBe('verification_failed')
    expect(fetchMock).not.toHaveBeenCalled()
    vi.doUnmock('@/lib/turnstile')
    vi.resetModules()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/api/register-phone-route.test.ts`
Expected: FAIL — register-action tests get a 501/`not_implemented` instead of real behavior

- [ ] **Step 3: Write minimal implementation**

Replace the final `return Response.json({ ok: false, error: 'not_implemented' }, { status: 501 })` line in `app/api/build/register-phone/route.ts` with:

```typescript
  const rawPhone = String(b?.phone || '')
  const otpCode = String(b?.otp_code || '')
  const phone = toE164(rawPhone)
  if (!phone) return Response.json({ ok: false, error: 'invalid_phone' }, { status: 400 })
  if (!otpCode) return Response.json({ ok: false, error: 'invalid_request' }, { status: 400 })

  if (turnstileEnabled()) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    const verification = await verifyTurnstileToken(
      typeof b?.turnstileToken === 'string' ? b.turnstileToken : null,
      ip,
    )
    if (!verification.success) {
      return Response.json({ ok: false, error: 'verification_failed' }, { status: 400 })
    }
  }

  try {
    const res = await fetch(`${CORE}/api/v1/auth/register-phone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, otp_code: otpCode }),
      signal: AbortSignal.timeout(25000),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      const detail = typeof data?.detail === 'string' ? data.detail : (data?.detail?.message || 'registration failed')
      return Response.json({ ok: false, error: detail }, { status: res.status })
    }
    return Response.json({
      ok: true,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    })
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message || e).slice(0, 120) }, { status: 502 })
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/api/register-phone-route.test.ts`
Expected: PASS (8 tests total)

- [ ] **Step 5: Commit**

```bash
git add app/api/build/register-phone/route.ts __tests__/api/register-phone-route.test.ts
git commit -m "feat(auth): register-phone route — register action, Turnstile-gated (#944)"
```

---

## Task 3: `login-phone` route

**Files:**
- Create: `app/api/build/login-phone/route.ts`
- Test: `__tests__/api/login-phone-route.test.ts`

**Interfaces:**
- Consumes: `toE164` from `@/lib/build/phone`.
- Produces: `POST` handler at `/api/build/login-phone`. Body `{ phone: string, otp_code: string }` → `{ ok: true, accessToken, refreshToken, expiresIn } | { ok: false, error: string, errorCode?: string }`. `errorCode: 'NO_SUCH_PHONE_ACCOUNT'` is the detection signal Task 8 (Auth.tsx) uses to route a founder with no existing account into the register flow instead of showing a dead-end error — see Review Focus item 2.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/api/login-phone-route.test.ts
/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

function req(body: unknown) {
  return { json: async () => body } as any
}

describe('POST /api/build/login-phone', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('rejects an invalid phone before calling core', async () => {
    const { POST } = await import('@/app/api/build/login-phone/route')
    const res = await POST(req({ phone: 'bad', otp_code: '123456' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_phone')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a missing otp_code before calling core', async () => {
    const { POST } = await import('@/app/api/build/login-phone/route')
    const res = await POST(req({ phone: '5125551234' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_request')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('proxies to core login-phone and returns raw tokens on success', async () => {
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ access_token: 'tok-xyz', refresh_token: 'ref-xyz', expires_in: 3600 }),
    })
    const { POST } = await import('@/app/api/build/login-phone/route')
    const res = await POST(req({ phone: '5125551234', otp_code: '123456' }))
    const d = await res.json()
    expect(res.status).toBe(200)
    expect(d).toEqual({ ok: true, accessToken: 'tok-xyz', refreshToken: 'ref-xyz', expiresIn: 3600 })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/auth/login-phone'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ phone: '+15125551234', otp_code: '123456' }),
      }),
    )
  })

  it('surfaces a 404 from core as a distinct NO_SUCH_PHONE_ACCOUNT errorCode', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({ detail: 'no account found' }) })
    const { POST } = await import('@/app/api/build/login-phone/route')
    const res = await POST(req({ phone: '5125551234', otp_code: '123456' }))
    const d = await res.json()
    expect(res.status).toBe(404)
    expect(d.ok).toBe(false)
    expect(d.errorCode).toBe('NO_SUCH_PHONE_ACCOUNT')
  })

  it('surfaces any other core failure without the special errorCode', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ detail: 'invalid otp' }) })
    const { POST } = await import('@/app/api/build/login-phone/route')
    const res = await POST(req({ phone: '5125551234', otp_code: '000000' }))
    const d = await res.json()
    expect(res.status).toBe(400)
    expect(d.ok).toBe(false)
    expect(d.errorCode).toBeUndefined()
    expect(d.error).toBe('invalid otp')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/api/login-phone-route.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/build/login-phone/route'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// app/api/build/login-phone/route.ts
/**
 * POST /api/build/login-phone (#944 Part 2) — mobile-first, passwordless
 * phone login. Proxies core's /auth/login-phone. No Turnstile gate — login
 * isn't the bot-signup surface Turnstile protects (register-phone's
 * register action is gated; this mirrors register/route.ts's own
 * login-check path, which also isn't gated).
 *
 * As of 2026-10-06, core's /auth/login-phone is merged but NOT live in
 * production (core#8512, tracked separately) — built/tested against the
 * documented/code-read contract only.
 *
 * Body:    { phone: string, otp_code: string }
 * Returns: { ok: true, accessToken, refreshToken, expiresIn }
 *        | { ok: false, error: string, errorCode?: 'NO_SUCH_PHONE_ACCOUNT' }
 *
 * `errorCode: 'NO_SUCH_PHONE_ACCOUNT'` (core returning 404) is the signal
 * Auth.tsx uses to route a founder with no existing account into
 * register-phone instead of showing a dead-end error.
 */
import { NextRequest } from 'next/server'
import { toE164 } from '@/lib/build/phone'

export const runtime = 'nodejs'

const CORE = process.env.AINATIVE_API_URL || process.env.AINATIVE_API_BASE_URL || 'https://api.ainative.studio'

export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => null)
  const rawPhone = String(b?.phone || '')
  const otpCode = String(b?.otp_code || '')
  const phone = toE164(rawPhone)
  if (!phone) return Response.json({ ok: false, error: 'invalid_phone' }, { status: 400 })
  if (!otpCode) return Response.json({ ok: false, error: 'invalid_request' }, { status: 400 })

  try {
    const res = await fetch(`${CORE}/api/v1/auth/login-phone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, otp_code: otpCode }),
      signal: AbortSignal.timeout(25000),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      const detail = typeof data?.detail === 'string' ? data.detail : (data?.detail?.message || 'login failed')
      return Response.json(
        { ok: false, error: detail, errorCode: res.status === 404 ? 'NO_SUCH_PHONE_ACCOUNT' : undefined },
        { status: res.status },
      )
    }
    return Response.json({
      ok: true,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    })
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message || e).slice(0, 120) }, { status: 502 })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/api/login-phone-route.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add app/api/build/login-phone/route.ts __tests__/api/login-phone-route.test.ts
git commit -m "feat(auth): login-phone route, with NO_SUCH_PHONE_ACCOUNT detection (#944)"
```

---

## Task 4: `phone-login` next-auth provider

**Files:**
- Modify: `app/(auth)/auth.ts`
- Test: `__tests__/lib/auth/phone-login-provider.test.ts`

**Interfaces:**
- Consumes: the file's existing `resolveDefaultWorkspace` function (signature unchanged: `(accessToken: string, fallback: {id, name}) => Promise<{id, name}>`), existing `UserType = 'ainative'`.
- Produces: a `phone-login` Credentials provider callable via `signIn('phone-login', { redirect: false, accessToken, refreshToken, expiresIn })`. Task 8 (Auth.tsx) depends on this exact call shape. On success, the resulting session has `session.user.email === null` (never `undefined`).

Since `app/(auth)/auth.ts` exports its built `auth`/`signIn`/`signOut` directly from `NextAuth(...)` (no standalone exported `authOptions` object to import), this provider's `authorize()` logic is tested by extracting it as a small testable helper rather than invoking the full NextAuth stack — matching how `__tests__/lib/auth/resolve-default-organization-id.test.ts` already tests a helper out of this auth module family in isolation.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/auth/phone-login-provider.test.ts
/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('authorizePhoneLogin (#944) — phone-login provider logic', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns null when no accessToken is present', async () => {
    const { authorizePhoneLogin } = await import('@/lib/auth/phone-login')
    const result = await authorizePhoneLogin({})
    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('builds a session user with email explicitly null and type ainative', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/v1/auth/me')) {
        return Promise.resolve({ ok: true, json: async () => ({ id: 'u-1', full_name: 'Jordan R' }) })
      }
      if (url.includes('/api/v1/workspaces')) {
        return Promise.resolve({ ok: true, json: async () => ({ workspaces: [{ id: 'ws-1', name: 'Jordan R', is_default: true }] }) })
      }
      return Promise.resolve({ ok: false })
    })
    const { authorizePhoneLogin } = await import('@/lib/auth/phone-login')
    const result = await authorizePhoneLogin({ accessToken: 'tok-1', refreshToken: 'ref-1', expiresIn: '3600' })
    expect(result).toEqual({
      id: 'u-1',
      email: null,
      name: 'Jordan R',
      type: 'ainative',
      accessToken: 'tok-1',
      refreshToken: 'ref-1',
      expiresIn: 3600,
      workspaceId: 'ws-1',
      workspaceName: 'Jordan R',
    })
  })

  it('falls back to a phone-derived name when /v1/auth/me returns no name', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/v1/auth/me')) {
        return Promise.resolve({ ok: true, json: async () => ({ id: 'u-2', phone: '+15125551234' }) })
      }
      if (url.includes('/api/v1/workspaces')) {
        return Promise.resolve({ ok: true, json: async () => ({ workspaces: [] }) })
      }
      return Promise.resolve({ ok: false })
    })
    const { authorizePhoneLogin } = await import('@/lib/auth/phone-login')
    const result = await authorizePhoneLogin({ accessToken: 'tok-2' })
    expect(result?.name).toBe('+15125551234')
  })

  it('returns null, never throws, when /v1/auth/me fails', async () => {
    fetchMock.mockResolvedValue({ ok: false })
    const { authorizePhoneLogin } = await import('@/lib/auth/phone-login')
    const result = await authorizePhoneLogin({ accessToken: 'tok-3' })
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/auth/phone-login-provider.test.ts`
Expected: FAIL — `Cannot find module '@/lib/auth/phone-login'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/auth/phone-login.ts
/**
 * #944 Part 2 — authorize() logic for the `phone-login` next-auth
 * Credentials provider, extracted into a standalone, directly-testable
 * function (app/(auth)/auth.ts exports only the built NextAuth() instance,
 * not a reusable authOptions object — same pattern as
 * resolve-default-organization-id.test.ts testing a sibling helper out of
 * this auth module family in isolation).
 *
 * Mirrors the existing `ainative-oauth` provider's shape exactly: adopts an
 * ALREADY-VERIFIED access token (core's /register-phone or /login-phone
 * already issued it) into a session — no password, ever, on this path.
 * `email` is explicitly null (not omitted) since a phone-only account has
 * none — downstream code reading session.user.email must see an explicit
 * absence, not undefined from a missing key.
 */
export type PhoneLoginCreds = {
  accessToken?: string
  refreshToken?: string
  expiresIn?: string | number
}

type Workspace = { id: string | null; name: string | null }

async function resolveWorkspace(accessToken: string): Promise<Workspace> {
  try {
    const res = await fetch(
      `${process.env.AINATIVE_API_BASE_URL}/api/v1/workspaces`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    if (res.ok) {
      const data = await res.json()
      const workspaces: any[] = data?.workspaces ?? []
      if (workspaces.length > 0) {
        const chosen = workspaces.find((w) => w.is_default) ?? workspaces[0]
        return { id: chosen.id ?? null, name: chosen.name ?? null }
      }
    }
  } catch {
    /* best-effort, falls through to null */
  }
  return { id: null, name: null }
}

export async function authorizePhoneLogin(creds: PhoneLoginCreds) {
  if (!creds?.accessToken) return null

  try {
    const profileRes = await fetch(`${process.env.AINATIVE_API_BASE_URL}/v1/auth/me`, {
      headers: { Authorization: `Bearer ${creds.accessToken}` },
    })
    if (!profileRes.ok) return null
    const profile = await profileRes.json()
    if (!profile?.id) return null

    const workspace = await resolveWorkspace(creds.accessToken)

    return {
      id: profile.id,
      email: null,
      name: profile.full_name || profile.phone || 'AINative User',
      type: 'ainative' as const,
      accessToken: creds.accessToken,
      refreshToken: creds.refreshToken || undefined,
      expiresIn: creds.expiresIn ? Number(creds.expiresIn) : undefined,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
    }
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/auth/phone-login-provider.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/auth/phone-login.ts __tests__/lib/auth/phone-login-provider.test.ts
git commit -m "feat(auth): extract authorizePhoneLogin helper for the phone-login provider (#944)"
```

---

## Task 5: Wire the `phone-login` provider into `app/(auth)/auth.ts`

**Files:**
- Modify: `app/(auth)/auth.ts`

**Interfaces:**
- Consumes: `authorizePhoneLogin` from `@/lib/auth/phone-login` (Task 4).
- Produces: `signIn('phone-login', { redirect: false, accessToken, refreshToken, expiresIn })` becomes callable from client code (Task 8). This is the last piece of the auth backend; no later task depends on anything new from this file.

No new test file — this task is a thin wiring change over already-tested logic (`authorizePhoneLogin`). Verified via the existing full-suite run in Task 9, plus a manual TypeScript compile check here since next-auth provider typing is strict.

- [ ] **Step 1: Add the import**

In `app/(auth)/auth.ts`, add near the other local imports (after the `shouldRefreshToken, refreshAINativeToken` import line):

```typescript
import { authorizePhoneLogin } from '@/lib/auth/phone-login'
```

- [ ] **Step 2: Add the provider**

Insert immediately after the `ainative-oauth` provider's closing `}),` (the line containing just `}),` right before the providers array's closing `],`):

```typescript
    Credentials({
      id: 'phone-login',
      credentials: {},
      async authorize(creds: any) {
        return authorizePhoneLogin(creds)
      },
    }),
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors introduced by this file.

- [ ] **Step 4: Commit**

```bash
git add "app/(auth)/auth.ts"
git commit -m "feat(auth): wire phone-login provider into next-auth (#944)"
```

---

## Task 6: CSS — phone-first form visibility + escape-hatch override

**Files:**
- Modify: `app/modernist.css`

**Interfaces:**
- Produces: three classes Task 7 depends on — `.m-auth-phone-form` (hidden by default, shown under the mobile breakpoint), `.m-auth-force-email` (an override class on `.m-auth` that hides the phone form and shows the email form regardless of viewport), `.m-auth-force-phone` (the inverse override, for a desktop user who explicitly wants the phone path — included for symmetry even though the primary use case is mobile-default).

- [ ] **Step 1: Add the rules**

In `app/modernist.css`, inside the existing `@media (max-width: 760px) { ... }` block that starts at line 1702 (`/* Auth + pricing stacks and touch ergonomics (#334, #335, #339). */`), add immediately after the existing `.m-auth-header { top: 20px; left: 24px; right: 24px; }` line:

```css
  /* #944 Part 2 — mobile-first phone login. Default on mobile: show the
     phone-first form, hide the email/password form. .m-auth-force-email
     (escape hatch, both directions) overrides this regardless of viewport. */
  .m-auth-phone-form { display: flex; }
  .m-auth-fields-email { display: none; }
  .m-auth.m-auth-force-email .m-auth-phone-form { display: none; }
  .m-auth.m-auth-force-email .m-auth-fields-email { display: flex; }
```

Then, outside any media query — alongside the other base `.m-auth*` rules starting at line 1249 — add:

```css
/* #944 Part 2 — above the mobile breakpoint, default to the existing
   email/password form; .m-auth-force-phone is the explicit opt-in. */
.m-auth-phone-form { display: none; }
.m-auth.m-auth-force-phone .m-auth-phone-form { display: flex; }
.m-auth.m-auth-force-phone .m-auth-fields-email { display: none; }
```

- [ ] **Step 2: Visual sanity check (no automated test — pure CSS)**

Run the dev server (`npm run dev`) and resize the `/login` or `/signup` screen's viewport in a browser below/above 760px to confirm: below 760px, the phone form shows and the email form is hidden by default; above 760px, the reverse; in both ranges, toggling a `m-auth-force-email`/`m-auth-force-phone` class via devtools flips which form shows regardless of width. (A real escape-hatch button toggling this class is wired in Task 7/8 — this step only confirms the CSS contract itself.)

- [ ] **Step 3: Commit**

```bash
git add app/modernist.css
git commit -m "feat(auth): CSS for mobile-default phone-first form + escape hatch (#944)"
```

---

## Task 7: `Auth.tsx` — phone-first form state + JSX

**Files:**
- Modify: `components/build/screens/Auth.tsx`
- Test: `__tests__/components/build/Auth-phone-form.test.tsx`

**Interfaces:**
- Consumes: `toE164` from `@/lib/build/phone` (already imported in this file), the CSS classes from Task 6.
- Produces: a new `showPhoneForm: 'auto' | 'email' | 'phone'` state var (drives the `m-auth-force-*` class) and a phone-first form block with `data-testid="auth-phone-form"`. Task 8 adds the submit logic inside this block; this task only renders the static shape + local UI state (phone input, step transitions, escape-hatch toggle) with stubbed submit handlers that Task 8 fills in — so this task's tests only cover rendering and local state, not network calls.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/components/build/Auth-phone-form.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const h = vi.hoisted(() => ({ dispatch: vi.fn(), signIn: vi.fn() }))

vi.mock('@/contexts/build-context', () => ({
  useBuild: () => ({
    state: { appSub: null, pendingBuild: null, track: 'app' },
    dispatch: h.dispatch,
  }),
}))
vi.mock('next-auth/react', () => ({ signIn: h.signIn }))
vi.mock('@/components/analytics/google-analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('@/components/analytics/meta-pixel', () => ({ trackMeta: vi.fn() }))
vi.mock('@/lib/build/guest-migration', () => ({ migrateGuestWork: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/build/attribution', () => ({ getRefCode: () => null }))
vi.mock('@/lib/build/value-moment', () => ({ decideLimitAction: vi.fn() }))
vi.mock('@/components/turnstile-widget', () => ({ TurnstileWidget: () => null }))

import { Auth } from '@/components/build/screens/Auth'

describe('Auth — phone-first form shell (#944)', () => {
  beforeEach(() => { h.dispatch.mockReset(); h.signIn.mockReset() })

  it('renders the phone-first form block alongside the email form', () => {
    render(<Auth mode="signup" />)
    expect(screen.getByTestId('auth-phone-form')).toBeInTheDocument()
  })

  it('shows a phone input and a Send code button initially', () => {
    render(<Auth mode="signup" />)
    const phoneForm = screen.getByTestId('auth-phone-form')
    expect(phoneForm.querySelector('input[type="tel"]')).toBeInTheDocument()
    expect(screen.getByTestId('phone-send-code')).toBeInTheDocument()
  })

  it('has an escape-hatch control to switch to the email form, and back', () => {
    render(<Auth mode="signup" />)
    const toEmail = screen.getByTestId('auth-use-email-instead')
    expect(toEmail).toBeInTheDocument()
    fireEvent.click(toEmail)
    expect(screen.getByTestId('auth-use-phone-instead')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/components/build/Auth-phone-form.test.tsx`
Expected: FAIL — `auth-phone-form` testid not found

- [ ] **Step 3: Write minimal implementation**

In `components/build/screens/Auth.tsx`, add new state alongside the existing phone-OTP-add-on state block (after the `turnstileRequired` line, before the `resetSent`/`resetDone` block):

```typescript
  // #944 Part 2 — mobile-first phone-primary login/signup. Fully separate
  // from the phone/verifyPhone/phoneVerified state above (#734's optional
  // verification add-on on the email/password path) — this is a parallel,
  // independent identity path with its own state, per the design spec's
  // explicit non-goal of merging the two.
  const [showPhoneForm, setShowPhoneForm] = useState<'auto' | 'email' | 'phone'>('auto')
  const [primaryPhone, setPrimaryPhone] = useState('')
  const [primaryPhoneStep, setPrimaryPhoneStep] = useState<'enter' | 'code'>('enter')
  const [primaryOtpCode, setPrimaryOtpCode] = useState('')
  const [phoneFormBusy, setPhoneFormBusy] = useState(false)
  const [phoneFormError, setPhoneFormError] = useState<string | null>(null)
```

The component has 4 separate `<div className="modernist m-auth">` return blocks: three early-returns for the `verifyEmail` (line ~487), `resetSent` (line ~518), and `resetDone` (line ~542) states, and the main form return at line 558 (`return (\n    <div className="modernist m-auth">`). Only the line-558 block is in scope — the other three are unrelated sub-states that never show the phone form. Change ONLY that one:

```typescript
<div className={`modernist m-auth ${showPhoneForm === 'email' ? 'm-auth-force-email' : showPhoneForm === 'phone' ? 'm-auth-force-phone' : ''}`}>
```

Inside that same main-form block, the existing `<div className="m-auth-fields">` (line 573) is followed by a shared error line, the `auth-submit` button, and (for login/signup) an "or / Continue with AINative" block (lines 623–642) — all of which belong to the email/password path and must hide together with it. Wrap all of them in one new `<div className="m-auth-fields-email">` (do NOT rename the existing `m-auth-fields` div itself — leave it as-is, nested one level deeper):

```tsx
<div className="m-auth-fields-email">
  <div className="m-auth-fields">
    {/* ... existing unchanged content of this div ... */}
  </div>
  {error && <p className="m-mono m-auth-error" style={{ color: '#e5451f' }}>{error}</p>}
  <button
    className="btn-primary"
    data-testid="auth-submit"
    onClick={submit}
    disabled={busy || (mode === 'signup' && turnstileRequired && !turnstileToken)}
  >
    {busy ? 'Working…' : `${copy.cta} →`}
  </button>
  {(mode === 'login' || mode === 'signup') && (
    <>
      <div className="m-auth-or m-mono"><span>or</span></div>
      <button className="btn-secondary" data-testid="auth-oauth-ainative" onClick={oauth} disabled={busy}>
        Continue with AINative
      </button>
    </>
  )}
</div>
```

This closes right before the existing `<div className="m-auth-links m-mono">` block (line 644), which stays outside the wrapper and always visible (it has its own `mode`-based conditionals for forgot/create-account/back-to-login that apply regardless of which form is showing). Add the new phone-form sibling block immediately after the `m-auth-fields-email` wrapper's closing `</div>`, before `<div className="m-auth-links m-mono">`:

```tsx
{(mode === 'login' || mode === 'signup') && (
  <div className="m-auth-phone-form" data-testid="auth-phone-form">
    {primaryPhoneStep === 'enter' && (
      <>
        <label className="m-field">
          <span className="m-mono m-field-l">Phone number</span>
          <input
            type="tel"
            value={primaryPhone}
            onChange={(e) => setPrimaryPhone(e.target.value)}
            placeholder="(512) 555-1234"
          />
        </label>
        {phoneFormError && <p className="m-auth-error">{phoneFormError}</p>}
        <button
          type="button"
          data-testid="phone-send-code"
          disabled={phoneFormBusy}
          onClick={() => { /* Task 8 fills this in */ }}
        >
          Send code
        </button>
      </>
    )}
    {primaryPhoneStep === 'code' && (
      <>
        <label className="m-field">
          <span className="m-mono m-field-l">Enter the code we texted you</span>
          <input
            type="text"
            inputMode="numeric"
            value={primaryOtpCode}
            onChange={(e) => setPrimaryOtpCode(e.target.value)}
            placeholder="123456"
          />
        </label>
        {phoneFormError && <p className="m-auth-error">{phoneFormError}</p>}
        <button
          type="button"
          data-testid="phone-submit-code"
          disabled={phoneFormBusy}
          onClick={() => { /* Task 8 fills this in */ }}
        >
          Continue
        </button>
      </>
    )}
    {showPhoneForm !== 'email' && (
      <button
        type="button"
        className="m-auth-escape"
        data-testid="auth-use-email-instead"
        onClick={() => setShowPhoneForm('email')}
      >
        Use email instead
      </button>
    )}
    {showPhoneForm === 'email' && (
      <button
        type="button"
        className="m-auth-escape"
        data-testid="auth-use-phone-instead"
        onClick={() => setShowPhoneForm('auto')}
      >
        Use phone instead
      </button>
    )}
  </div>
)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/components/build/Auth-phone-form.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add components/build/screens/Auth.tsx __tests__/components/build/Auth-phone-form.test.tsx
git commit -m "feat(auth): phone-first form shell + escape hatch in Auth.tsx (#944)"
```

---

## Task 8: `Auth.tsx` — wire phone-form submit logic (send-otp, register/login, sign-in)

**Files:**
- Modify: `components/build/screens/Auth.tsx`
- Test: `__tests__/components/build/Auth-phone-form.test.tsx`

**Interfaces:**
- Consumes: `/api/build/register-phone` (Tasks 1–2), `/api/build/login-phone` (Task 3), `signIn('phone-login', ...)` (Task 5), `toE164` (existing import), `migrateGuestWork`/`getRefCode` (existing imports, already used by the email/password `submit()` — reused here for parity, same as the spec's non-goal of NOT reinventing post-signin plumbing).
- Produces: fully working phone-form submission. No later task depends on anything new from here — this is the final task before the full-suite run.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/components/build/Auth-phone-form.test.tsx`:

```typescript
describe('Auth — phone-first form submission (#944)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    h.dispatch.mockReset()
    h.signIn.mockReset().mockResolvedValue({ error: null })
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('sends a code, then registers+signs in on a NEW phone number', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/api/build/register-phone') ) {
        return Promise.resolve({ json: async () => ({ ok: true, accessToken: 'tok', refreshToken: 'ref', expiresIn: 3600 }) })
      }
      return Promise.resolve({ json: async () => ({ ok: false }) })
    })
    render(<Auth mode="signup" />)
    fireEvent.change(screen.getByPlaceholderText('(512) 555-1234'), { target: { value: '5125551234' } })
    fireEvent.click(screen.getByTestId('phone-send-code'))
    await screen.findByTestId('phone-submit-code')
    fireEvent.change(screen.getByPlaceholderText('123456'), { target: { value: '000000' } })
    fireEvent.click(screen.getByTestId('phone-submit-code'))
    await vi.waitFor(() => expect(h.signIn).toHaveBeenCalledWith(
      'phone-login',
      expect.objectContaining({ redirect: false, accessToken: 'tok', refreshToken: 'ref', expiresIn: 3600 }),
    ))
  })

  it('falls back from login to register when core reports NO_SUCH_PHONE_ACCOUNT', async () => {
    let registerCalled = false
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/api/build/login-phone')) {
        return Promise.resolve({ json: async () => ({ ok: false, errorCode: 'NO_SUCH_PHONE_ACCOUNT' }) })
      }
      if (url.includes('/api/build/register-phone')) {
        registerCalled = true
        return Promise.resolve({ json: async () => ({ ok: true, accessToken: 'tok2', refreshToken: 'ref2', expiresIn: 3600 }) })
      }
      return Promise.resolve({ json: async () => ({ ok: false }) })
    })
    render(<Auth mode="login" />)
    fireEvent.change(screen.getByPlaceholderText('(512) 555-1234'), { target: { value: '5125551234' } })
    fireEvent.click(screen.getByTestId('phone-send-code'))
    await screen.findByTestId('phone-submit-code')
    fireEvent.change(screen.getByPlaceholderText('123456'), { target: { value: '000000' } })
    fireEvent.click(screen.getByTestId('phone-submit-code'))
    await vi.waitFor(() => expect(registerCalled).toBe(true))
  })

  it('shows a real error message, never hangs busy, when signIn fails after tokens are issued', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/api/build/login-phone')) {
        return Promise.resolve({ json: async () => ({ ok: true, accessToken: 'tok3', refreshToken: 'ref3', expiresIn: 3600 }) })
      }
      return Promise.resolve({ json: async () => ({ ok: false }) })
    })
    h.signIn.mockResolvedValue({ error: 'CredentialsSignin' })
    render(<Auth mode="login" />)
    fireEvent.change(screen.getByPlaceholderText('(512) 555-1234'), { target: { value: '5125551234' } })
    fireEvent.click(screen.getByTestId('phone-send-code'))
    await screen.findByTestId('phone-submit-code')
    fireEvent.change(screen.getByPlaceholderText('123456'), { target: { value: '000000' } })
    fireEvent.click(screen.getByTestId('phone-submit-code'))
    await screen.findByText(/could not sign you in/i)
    expect(screen.getByTestId('phone-submit-code')).not.toBeDisabled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/components/build/Auth-phone-form.test.tsx`
Expected: FAIL — the stubbed `onClick` handlers from Task 7 do nothing

- [ ] **Step 3: Write minimal implementation**

In `components/build/screens/Auth.tsx`, add these two handler functions near the existing `submit`/`submitReset` functions (same scope, same component):

```typescript
  const sendPrimaryPhoneCode = async () => {
    setPhoneFormError(null)
    const normalized = toE164(primaryPhone)
    if (!normalized) { setPhoneFormError('Enter a valid phone number.'); return }
    setPhoneFormBusy(true)
    try {
      const res = await fetch('/api/build/register-phone', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send-otp', phone: normalized }),
      })
      const d = await res.json().catch(() => null)
      if (!d?.ok) { setPhoneFormError('Could not send a code — try again.'); setPhoneFormBusy(false); return }
      setPrimaryPhoneStep('code')
    } catch {
      setPhoneFormError('Network error — try again.')
    } finally {
      setPhoneFormBusy(false)
    }
  }

  const submitPrimaryPhoneCode = async () => {
    setPhoneFormError(null)
    const normalized = toE164(primaryPhone)
    if (!normalized || !primaryOtpCode) { setPhoneFormError('Enter the code we texted you.'); return }
    setPhoneFormBusy(true)
    try {
      // Try login first; a core NO_SUCH_PHONE_ACCOUNT response means this
      // number has never registered, so fall back to register-phone — this
      // is the one request per attempt that decides which path applies,
      // since the UI has no other signal for "is this a new number."
      const loginRes = await fetch('/api/build/login-phone', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: normalized, otp_code: primaryOtpCode }),
      })
      let d = await loginRes.json().catch(() => null)
      if (!d?.ok && d?.errorCode === 'NO_SUCH_PHONE_ACCOUNT') {
        const registerRes = await fetch('/api/build/register-phone', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: normalized, otp_code: primaryOtpCode }),
        })
        d = await registerRes.json().catch(() => null)
      }
      if (!d?.ok) { setPhoneFormError(d?.error || 'Could not verify that code.'); setPhoneFormBusy(false); return }

      const result = await signIn('phone-login', {
        redirect: false,
        accessToken: d.accessToken,
        refreshToken: d.refreshToken,
        expiresIn: d.expiresIn,
      })
      if (result?.error) { setPhoneFormError('Could not sign you in — try again.'); setPhoneFormBusy(false); return }

      await migrateGuestWork(state.appSub).catch(() => {})
      const refCode = getRefCode()
      if (refCode) {
        fetch('/api/build/referral', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: refCode }),
        }).catch(() => {})
      }
      afterAuth()
    } catch {
      setPhoneFormError('Network error — try again.')
      setPhoneFormBusy(false)
    }
  }
```

Then replace the two stub `onClick` handlers from Task 7:

```typescript
onClick={() => { /* Task 8 fills this in */ }}
```

with, respectively:

```typescript
onClick={sendPrimaryPhoneCode}
```

and

```typescript
onClick={submitPrimaryPhoneCode}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/components/build/Auth-phone-form.test.tsx`
Expected: PASS (6 tests total)

- [ ] **Step 5: Commit**

```bash
git add components/build/screens/Auth.tsx __tests__/components/build/Auth-phone-form.test.tsx
git commit -m "feat(auth): wire phone-form submit — send-otp, login/register fallback, sign-in (#944)"
```

---

## Task 9: Full-suite verification + typecheck

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the whole repo**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass, including the 4 new test files from Tasks 1–4 and 7–8 (register-phone-route: 8, login-phone-route: 5, phone-login-provider: 4, Auth-phone-form: 6 = 23 new tests). Pre-existing flaky tests unrelated to this change (if any recur, e.g. the known `task-splitter.test.ts` timeout from earlier in this session) are not this plan's concern — only confirm nothing NEW fails.

- [ ] **Step 3: Commit (only if anything needed fixing)**

```bash
git add -A
git commit -m "test(auth): fix any cross-task integration issues found in full-suite run (#944)"
```

(Skip this step if Steps 1–2 passed clean with no changes needed.)

---

## Task 10: PR — and the live-verification blocker

**Files:** none (process step)

- [ ] **Step 1: Push the branch and open a PR**

```bash
git push -u origin feature/issue-944-phone-login-part2
gh pr create --title "feat(auth): mobile-first passwordless phone login — Part 2 (#944)" --body "$(cat <<'EOF'
Closes nothing yet — see below.

Implements Builder-side Part 2 of #944 per docs/superpowers/specs/2026-10-06-mobile-phone-login-part2-design.md: two new API routes (register-phone, login-phone) proxying core's merged phone-identity endpoints, a phone-login next-auth provider modeled on the existing ainative-oauth provider, and a CSS-breakpoint-gated mobile-first phone form in Auth.tsx with a required email escape hatch.

## Known blocker — do not merge until resolved

Core's /auth/register-phone and /auth/login-phone are merged to core main (core#8463, closing core#8459) but NOT live in production — core#8512 (open, owned by another team) tracks the deploy gap. This PR is built and unit-tested entirely against mocked fetch calls matching the documented/code-read contract; nothing here has been verified against the real network.

Before merge: re-run this against the live endpoint once core#8512 closes —
\`\`\`
curl -X POST https://api.ainative.studio/api/v1/auth/register-phone -H "Content-Type: application/json" -d '{"phone":"+1...", "otp_code":"..."}'
\`\`\`
— and do a real browser test of the mobile phone-form flow end-to-end (signup, login, and the NO_SUCH_PHONE_ACCOUNT fallback) before claiming this ships, per this repo's live-verification standard.

Real pnpm build confirmed clean; full vitest suite passing.
EOF
)"
```

- [ ] **Step 2: Do NOT merge**

Leave this PR open. Comment on issue #944 linking the PR and explicitly stating it is blocked on core#8512 for live verification, not ready for merge regardless of CI status.

```bash
gh issue comment 944 --body "Part 2 implementation up for review: <PR URL>. CI-green, fully unit-tested against the documented core contract — but NOT yet verified against a live core endpoint (core#8512 still open). Do not merge until core#8512 closes and the PR's live-verification checklist (in its description) is run for real."
```
