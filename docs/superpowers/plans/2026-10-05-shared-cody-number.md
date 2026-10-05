# Shared "Text Cody" Number Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a paid-tier founder text Cody on AINative's shared, already-wired number (`+1 937-764-2838`) without provisioning their own dedicated ZeroVoice number, with the same real conversational capability (`askCody()`, backlog dispatch) the dedicated-number path already has.

**Architecture:** A new, additive routing mode inside the existing `handleInboundSms` (`app/api/webhooks/zerovoice-sms/route.ts`) — tried only when the existing per-company lookup misses AND the inbound number matches the shared number. All new shared-number-specific logic (phone lookup, tier gate, disambiguation) lives in one new module, `lib/build/shared-cody-number.ts`, so the existing, production-carrying `handleInboundSms` gets only a small, clearly-bounded branch added to it, not a sprawl of new inline logic.

**Tech Stack:** Next.js API routes (Node runtime), TypeScript, ZeroDB REST API (Builder's own data layer, same pattern as `app-registry.ts`/`founder-phones.ts`), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-05-shared-cody-number-design.md`

## Global Constraints

- Shared number is `+19377642838`, read from `ZEROVOICE_SHARED_NUMBER` env var (default to the literal if unset, matching how other env-configurable constants in this codebase default).
- Paid-tier gate is server-side only, resolved from a stored founder credential — never trust anything in the inbound SMS payload as a tier claim.
- The existing dedicated-number routing's "no fallback company, ever" invariant must not be touched, weakened, or bypassed by the new code path.
- Reply SMS from the shared number must use the direct-Twilio send mechanism already proven in `lib/build/otp.ts` (`TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_OTP_FROM_NUMBER`) — NOT `sendZeroVoiceSms()`, whose own doc comment requires `fromE164` to be a company's own provisioned number, never a shared one.
- Disambiguation pending-state must be persisted in ZeroDB (new table), NOT in-memory — `lib/build/otp.ts`'s existing rate-limiter is in-memory and confirmed unsuitable (a serverless/edge deployment can route a founder's two texts to different instances, losing in-memory state between them).
- All new ZeroDB-backed functions follow the existing fail-closed, never-throw, `{ok, reason}`-shaped pattern already used throughout `lib/build/founder-phones.ts` and `lib/build/app-registry.ts`.

## Review Focus

- **A founder with zero companies texts the shared number** — spec says reply "You don't have any companies yet..."; verify this is reached BEFORE the tier check ever needs a company to resolve a credential against (if there are zero companies, there's no credential to resolve tier from at all — the spec's own ordering assumption needs resolving: can tier be checked with zero companies?).
- **A founder's phone is recorded but never OTP-verified** — must be treated identically to "no match," not silently granted access; this is a real security boundary (spoofed `From` must not impersonate a real founder).
- **Twilio send failure on the reply** (network error, Twilio 5xx) — the founder's inbound text must not appear to vanish silently; log loudly, matching `handleInboundSms`'s existing `console.error` pattern for failed sends.
- **A disambiguation reply arrives after the TTL expires** — must re-send the numbered list fresh, not silently fail or apply a stale, now-wrong company selection.
- **The existing dedicated-number flow for a founder who ALSO has the shared number memorized** — texting their own dedicated number must behave exactly as today (this is the existing code path, untouched; the new branch must only ever trigger on a `resolveAppByZeroVoiceNumber` miss).

---

## Task 1: Phone → founder lookup (fallback path only)

**Files:**
- Modify: `lib/build/founder-phones.ts` (add new exported function)
- Test: `__tests__/lib/build/founder-phones-lookup.test.ts` (new)

**Interfaces:**
- Consumes: nothing new (uses this file's existing `rowsUrl()`, `headers()`, `configured()` — already module-scoped, not exported, so the new function lives in this same file to reach them)
- Produces: `findFounderByPhone(e164: string): Promise<{ email: string } | null>` — consumed by Task 3

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/build/founder-phones-lookup.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const saved = { ...process.env }
beforeEach(() => {
  process.env.ZERODB_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-1'
})
afterEach(() => {
  process.env = { ...saved }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function mockRows(rows: Array<{ row_data: Record<string, unknown> }>) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    text: async () => JSON.stringify(rows),
  }) as unknown as Response))
}

import { findFounderByPhone } from '@/lib/build/founder-phones'

describe('findFounderByPhone', () => {
  it('returns null when unconfigured', async () => {
    delete process.env.ZERODB_API_KEY
    const result = await findFounderByPhone('+15550001111')
    expect(result).toBeNull()
  })

  it('returns null when no row matches the phone', async () => {
    mockRows([{ row_data: { email: 'a@b.com', phone: '+15559999999', verified: true, createdAt: '2026-01-01T00:00:00Z' } }])
    const result = await findFounderByPhone('+15550001111')
    expect(result).toBeNull()
  })

  it('returns null when the matching row is unverified', async () => {
    mockRows([{ row_data: { email: 'a@b.com', phone: '+15550001111', verified: false, createdAt: '2026-01-01T00:00:00Z' } }])
    const result = await findFounderByPhone('+15550001111')
    expect(result).toBeNull()
  })

  it('returns the email for a verified matching row', async () => {
    mockRows([{ row_data: { email: 'a@b.com', phone: '+15550001111', verified: true, createdAt: '2026-01-01T00:00:00Z' } }])
    const result = await findFounderByPhone('+15550001111')
    expect(result).toEqual({ email: 'a@b.com' })
  })

  it('picks the LATEST verified row when multiple exist for the same phone', async () => {
    mockRows([
      { row_data: { email: 'old@b.com', phone: '+15550001111', verified: true, createdAt: '2026-01-01T00:00:00Z' } },
      { row_data: { email: 'new@b.com', phone: '+15550001111', verified: true, createdAt: '2026-02-01T00:00:00Z' } },
    ])
    const result = await findFounderByPhone('+15550001111')
    expect(result).toEqual({ email: 'new@b.com' })
  })

  it('never throws on a network error — returns null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const result = await findFounderByPhone('+15550001111')
    expect(result).toBeNull()
  })

  it('never throws on a non-ok response — returns null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, text: async () => '' }) as unknown as Response))
    const result = await findFounderByPhone('+15550001111')
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/build/founder-phones-lookup.test.ts`
Expected: FAIL with "findFounderByPhone is not a function" or similar import error

- [ ] **Step 3: Write minimal implementation**

Add to `lib/build/founder-phones.ts` (after the existing `markFounderPhoneVerified` function):

```typescript
/**
 * Find the founder who owns a verified phone number (#936). Only a
 * `verified: true` row matches — an unverified phone entry (recorded but
 * never OTP-confirmed) must not grant SMS access to someone else's account
 * via a spoofed `From`. Picks the LATEST verified row when multiple exist
 * (latest-wins, matching this file's append-only write pattern). Returns
 * null on no match or any failure — never throws.
 */
export async function findFounderByPhone(e164: string): Promise<{ email: string } | null> {
  if (!configured() || !e164) return null
  try {
    const res = await fetch(`${rowsUrl()}?limit=1000`, { headers: headers(), signal: AbortSignal.timeout(15000) })
    if (!res.ok) return null
    const data = JSON.parse(await res.text())
    const rows = Array.isArray(data) ? data : data.data || data.rows || []
    const entries: FounderPhoneEntry[] = rows
      .map((r: { row_data?: FounderPhoneEntry }) => r.row_data)
      .filter((rd: FounderPhoneEntry | undefined): rd is FounderPhoneEntry =>
        !!rd && rd.phone === e164 && rd.verified === true,
      )
    if (entries.length === 0) return null
    entries.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    return { email: entries[0].email }
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/build/founder-phones-lookup.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/build/founder-phones.ts __tests__/lib/build/founder-phones-lookup.test.ts
git commit -m "feat(sms): add findFounderByPhone lookup (#936)"
```

---

## Task 2: Disambiguation state store (new ZeroDB table)

**Files:**
- Create: `lib/build/sms-disambiguation.ts`
- Test: `__tests__/lib/build/sms-disambiguation.test.ts`

**Interfaces:**
- Consumes: nothing new (same `AINATIVE_API`/`API_KEY`/`PROJECT_ID`/fetch pattern as `founder-phones.ts`, duplicated locally since those are module-private consts in that file, not exported)
- Produces:
  - `setPendingDisambiguation(fromNumber: string, companies: Array<{ slug: string; name: string }>): Promise<boolean>`
  - `getPendingDisambiguation(fromNumber: string): Promise<Array<{ slug: string; name: string }> | null>` — returns `null` if none exists OR the stored entry has expired (TTL check happens inside this function, callers never see a stale entry)
  - `clearPendingDisambiguation(fromNumber: string): Promise<boolean>` — consumed by Task 3 once a disambiguation reply resolves

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/build/sms-disambiguation.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const saved = { ...process.env }
beforeEach(() => {
  process.env.ZERODB_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-1'
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
})
afterEach(() => {
  process.env = { ...saved }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

import { setPendingDisambiguation, getPendingDisambiguation, clearPendingDisambiguation } from '@/lib/build/sms-disambiguation'

function mockFetchSequence(impl: (url: string, init?: RequestInit) => { ok: boolean; text?: string }) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const r = impl(String(url), init)
    return { ok: r.ok, text: async () => (r.text ?? '') } as unknown as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('setPendingDisambiguation', () => {
  it('writes a row and returns true on success', async () => {
    const fn = mockFetchSequence(() => ({ ok: true }))
    const result = await setPendingDisambiguation('+15550001111', [{ slug: 'acme', name: 'Acme' }])
    expect(result).toBe(true)
    expect(fn).toHaveBeenCalled()
  })

  it('returns false on a write failure, never throws', async () => {
    mockFetchSequence(() => ({ ok: false }))
    const result = await setPendingDisambiguation('+15550001111', [{ slug: 'acme', name: 'Acme' }])
    expect(result).toBe(false)
  })
})

describe('getPendingDisambiguation', () => {
  it('returns null when no row exists for this number', async () => {
    mockFetchSequence(() => ({ ok: true, text: JSON.stringify([]) }))
    const result = await getPendingDisambiguation('+15550001111')
    expect(result).toBeNull()
  })

  it('returns the companies list for a fresh, unexpired entry', async () => {
    const expiresAt = new Date('2026-01-01T00:08:00.000Z').toISOString() // 8 min out, within a 10-min TTL
    mockFetchSequence(() => ({
      ok: true,
      text: JSON.stringify([{
        row_data: { fromNumber: '+15550001111', companies: [{ slug: 'acme', name: 'Acme' }], expiresAt, createdAt: '2026-01-01T00:00:00.000Z' },
      }]),
    }))
    const result = await getPendingDisambiguation('+15550001111')
    expect(result).toEqual([{ slug: 'acme', name: 'Acme' }])
  })

  it('returns null for an EXPIRED entry, even though a row exists', async () => {
    const expiresAt = new Date('2025-12-31T23:00:00.000Z').toISOString() // in the past relative to mocked "now"
    mockFetchSequence(() => ({
      ok: true,
      text: JSON.stringify([{
        row_data: { fromNumber: '+15550001111', companies: [{ slug: 'acme', name: 'Acme' }], expiresAt, createdAt: '2025-12-31T22:50:00.000Z' },
      }]),
    }))
    const result = await getPendingDisambiguation('+15550001111')
    expect(result).toBeNull()
  })

  it('picks the LATEST row when multiple exist for the same number', async () => {
    const freshExpiresAt = new Date('2026-01-01T00:09:00.000Z').toISOString()
    mockFetchSequence(() => ({
      ok: true,
      text: JSON.stringify([
        { row_data: { fromNumber: '+15550001111', companies: [{ slug: 'old', name: 'Old' }], expiresAt: '2025-12-31T00:00:00.000Z', createdAt: '2025-12-31T00:00:00.000Z' } },
        { row_data: { fromNumber: '+15550001111', companies: [{ slug: 'acme', name: 'Acme' }], expiresAt: freshExpiresAt, createdAt: '2026-01-01T00:00:00.000Z' } },
      ]),
    }))
    const result = await getPendingDisambiguation('+15550001111')
    expect(result).toEqual([{ slug: 'acme', name: 'Acme' }])
  })

  it('never throws on a network error — returns null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    const result = await getPendingDisambiguation('+15550001111')
    expect(result).toBeNull()
  })
})

describe('clearPendingDisambiguation', () => {
  it('writes a cleared/expired marker row and returns true on success', async () => {
    const fn = mockFetchSequence(() => ({ ok: true }))
    const result = await clearPendingDisambiguation('+15550001111')
    expect(result).toBe(true)
    expect(fn).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/build/sms-disambiguation.test.ts`
Expected: FAIL — module `@/lib/build/sms-disambiguation` doesn't exist

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/build/sms-disambiguation.ts
/**
 * Short-lived, ZeroDB-backed pending-disambiguation state for the shared
 * Text-Cody number (#936). A founder with 2+ companies gets a numbered list
 * and must reply with a number — but the question and the reply arrive as
 * two SEPARATE, stateless webhook calls. In-memory state (the pattern
 * lib/build/otp.ts's rate-limiter uses) is confirmed unsuitable here: a
 * serverless/edge deployment can route the two calls to different
 * instances, losing in-memory state between them. This follows the exact
 * append-only ZeroDB pattern lib/build/founder-phones.ts already uses.
 */

import { getAinativeApiKey } from '@/lib/build/env-keys'

const AINATIVE_API = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const API_KEY = getAinativeApiKey()
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || ''
const TABLE = 'builder_sms_disambiguation'
const TTL_MS = 10 * 60 * 1000 // 10 minutes

function rowsUrl(): string {
  return `${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables/${TABLE}/rows`
}
function headers(): Record<string, string> {
  return { Authorization: `Bearer ${API_KEY}`, 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }
}
function configured(): boolean {
  return Boolean(API_KEY && PROJECT_ID)
}

export interface PendingCompany {
  slug: string
  name: string
}

interface DisambiguationRow {
  fromNumber: string
  companies: PendingCompany[]
  expiresAt: string
  createdAt: string
}

/** Record a pending disambiguation question for this phone number. Best-effort. */
export async function setPendingDisambiguation(fromNumber: string, companies: PendingCompany[]): Promise<boolean> {
  if (!configured() || !fromNumber || companies.length === 0) return false
  try {
    const now = new Date()
    const res = await fetch(rowsUrl(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        row_data: {
          fromNumber,
          companies,
          expiresAt: new Date(now.getTime() + TTL_MS).toISOString(),
          createdAt: now.toISOString(),
        } satisfies DisambiguationRow,
      }),
      signal: AbortSignal.timeout(15000),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Read the pending companies list for this phone number, or null if none
 * exists or it has expired. Expiry is checked here, not left to the caller —
 * an expired entry must never be silently treated as still valid.
 */
export async function getPendingDisambiguation(fromNumber: string): Promise<PendingCompany[] | null> {
  if (!configured() || !fromNumber) return null
  try {
    const res = await fetch(`${rowsUrl()}?limit=1000`, { headers: headers(), signal: AbortSignal.timeout(15000) })
    if (!res.ok) return null
    const data = JSON.parse(await res.text())
    const rows = Array.isArray(data) ? data : data.data || data.rows || []
    const entries: DisambiguationRow[] = rows
      .map((r: { row_data?: DisambiguationRow }) => r.row_data)
      .filter((rd: DisambiguationRow | undefined): rd is DisambiguationRow => !!rd && rd.fromNumber === fromNumber)
    if (entries.length === 0) return null
    entries.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    const latest = entries[0]
    if (new Date(latest.expiresAt).getTime() <= Date.now()) return null
    return latest.companies
  } catch {
    return null
  }
}

/** Append a cleared/already-expired marker so a resolved disambiguation
 *  doesn't get re-read as still-pending by a later getPendingDisambiguation
 *  call (append-only store — this writes a new row with expiresAt in the
 *  past, which getPendingDisambiguation's own expiry check already treats
 *  as invalid, rather than requiring a separate "is this cleared" flag). */
export async function clearPendingDisambiguation(fromNumber: string): Promise<boolean> {
  if (!configured() || !fromNumber) return false
  try {
    const now = new Date()
    const res = await fetch(rowsUrl(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        row_data: {
          fromNumber,
          companies: [],
          expiresAt: new Date(now.getTime() - 1000).toISOString(),
          createdAt: now.toISOString(),
        } satisfies DisambiguationRow,
      }),
      signal: AbortSignal.timeout(15000),
    })
    return res.ok
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/build/sms-disambiguation.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/build/sms-disambiguation.ts __tests__/lib/build/sms-disambiguation.test.ts
git commit -m "feat(sms): add ZeroDB-backed disambiguation state store (#936)"
```

---

## Task 3: Shared-number conversation orchestration module

**Files:**
- Create: `lib/build/shared-cody-number.ts`
- Test: `__tests__/lib/build/shared-cody-number.test.ts`

**Interfaces:**
- Consumes:
  - `findFounderByPhone(e164: string): Promise<{ email: string } | null>` (Task 1)
  - `setPendingDisambiguation`, `getPendingDisambiguation`, `clearPendingDisambiguation` (Task 2)
  - `listAppsForOwner(ownerEmail: string): Promise<AppEntry[]>` from `@/lib/build/app-registry` (existing — `AppEntry` has `slug: string`, `name?: string`)
  - `resolveFounderCredential(slug: string, primitive: FounderScopedPrimitive): Promise<ResolvedCredential>` from `@/lib/build/primitive-credentials` (existing — `ResolvedCredential` has `ok: boolean`, `accessToken?: string`)
  - `getPlanStatus(token: string): Promise<{ tier?: string }>` from `@/lib/ainative/plan` (existing)
  - `isPaidTier(tier: string | undefined | null): boolean` from `@/lib/ainative/plan` (existing)
- Produces: `handleSharedNumberSms(from: string, body: string): Promise<SharedNumberResult>` — consumed by Task 4 (the webhook route)

```typescript
export interface SharedNumberResult {
  /** The exact text to send back to `from`, or null if nothing should be sent (should not happen in practice — every real branch has a reply). */
  replyText: string | null
  /** The company slug the conversation resolved to, if any — passed to askCody() by the caller. Null when the result is itself a reply (no-match, not-paid, no-companies, disambiguation-prompt) rather than a resolved conversation. */
  resolvedSlug: string | null
  resolvedOwnerEmail: string | null
}
```

**Sequencing note for the implementer:** the spec's own ordering (lookup → tier check → list companies → disambiguate) has a real gap: `resolveFounderCredential` is keyed by company SLUG, not founder email, so tier cannot be checked until at least one company is known. The real order this task implements is: lookup founder → list their companies → if zero, reply "no companies yet" (tier is irrelevant with no companies to be paid for) → else resolve tier via the FIRST company in the list (tier is a founder-level AINative plan property; any one of their companies' stored credential reveals the same plan) → gate on tier → then disambiguate among companies if 2+.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/build/shared-cody-number.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  findFounderByPhone: vi.fn(),
  listAppsForOwner: vi.fn(),
  resolveFounderCredential: vi.fn(),
  getPlanStatus: vi.fn(),
  getPendingDisambiguation: vi.fn(),
  setPendingDisambiguation: vi.fn(),
  clearPendingDisambiguation: vi.fn(),
}))

vi.mock('@/lib/build/founder-phones', () => ({ findFounderByPhone: h.findFounderByPhone }))
vi.mock('@/lib/build/app-registry', () => ({ listAppsForOwner: h.listAppsForOwner }))
vi.mock('@/lib/build/primitive-credentials', () => ({ resolveFounderCredential: h.resolveFounderCredential }))
vi.mock('@/lib/ainative/plan', () => ({
  getPlanStatus: h.getPlanStatus,
  isPaidTier: (tier: string | undefined | null) => ['pro', 'business', 'enterprise', 'cody_vcto'].includes(String(tier).toLowerCase()),
}))
vi.mock('@/lib/build/sms-disambiguation', () => ({
  getPendingDisambiguation: h.getPendingDisambiguation,
  setPendingDisambiguation: h.setPendingDisambiguation,
  clearPendingDisambiguation: h.clearPendingDisambiguation,
}))

import { handleSharedNumberSms } from '@/lib/build/shared-cody-number'

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset())
  h.getPendingDisambiguation.mockResolvedValue(null)
})
afterEach(() => vi.restoreAllMocks())

describe('handleSharedNumberSms', () => {
  it('replies with a clear next step when the phone matches no founder', async () => {
    h.findFounderByPhone.mockResolvedValue(null)
    const result = await handleSharedNumberSms('+15550009999', 'hi')
    expect(result.resolvedSlug).toBeNull()
    expect(result.replyText).toMatch(/phone number on your AINative account|sign up/i)
  })

  it('replies "no companies yet" when the founder has zero companies', async () => {
    h.findFounderByPhone.mockResolvedValue({ email: 'a@b.com' })
    h.listAppsForOwner.mockResolvedValue([])
    const result = await handleSharedNumberSms('+15550001111', 'hi')
    expect(result.resolvedSlug).toBeNull()
    expect(result.replyText).toMatch(/don't have any companies/i)
  })

  it('replies with an upgrade prompt when the founder is not on a paid tier', async () => {
    h.findFounderByPhone.mockResolvedValue({ email: 'a@b.com' })
    h.listAppsForOwner.mockResolvedValue([{ slug: 'acme', name: 'Acme', chatId: 'c1' }])
    h.resolveFounderCredential.mockResolvedValue({ ok: true, accessToken: 'tok' })
    h.getPlanStatus.mockResolvedValue({ tier: 'hobbyist' })
    const result = await handleSharedNumberSms('+15550001111', 'hi')
    expect(result.resolvedSlug).toBeNull()
    expect(result.replyText).toMatch(/paid-plan feature|upgrade/i)
  })

  it('fails closed (treats as not-paid) when tier resolution itself fails', async () => {
    h.findFounderByPhone.mockResolvedValue({ email: 'a@b.com' })
    h.listAppsForOwner.mockResolvedValue([{ slug: 'acme', name: 'Acme', chatId: 'c1' }])
    h.resolveFounderCredential.mockResolvedValue({ ok: false, reason: 'not_provisioned' })
    const result = await handleSharedNumberSms('+15550001111', 'hi')
    expect(result.resolvedSlug).toBeNull()
    expect(result.replyText).toMatch(/paid-plan feature|upgrade/i)
  })

  it('resolves immediately to the single company when the founder has exactly one', async () => {
    h.findFounderByPhone.mockResolvedValue({ email: 'a@b.com' })
    h.listAppsForOwner.mockResolvedValue([{ slug: 'acme', name: 'Acme', chatId: 'c1' }])
    h.resolveFounderCredential.mockResolvedValue({ ok: true, accessToken: 'tok' })
    h.getPlanStatus.mockResolvedValue({ tier: 'pro' })
    const result = await handleSharedNumberSms('+15550001111', 'what is the status of my app')
    expect(result.resolvedSlug).toBe('acme')
    expect(result.resolvedOwnerEmail).toBe('a@b.com')
    expect(result.replyText).toBeNull() // no reply here — caller (Task 4) runs askCody() and sends ITS answer
  })

  it('sends a numbered disambiguation list when the founder has 2+ companies and no pending state', async () => {
    h.findFounderByPhone.mockResolvedValue({ email: 'a@b.com' })
    h.listAppsForOwner.mockResolvedValue([
      { slug: 'acme', name: 'Acme', chatId: 'c1' },
      { slug: 'globex', name: 'Globex', chatId: 'c2' },
    ])
    h.resolveFounderCredential.mockResolvedValue({ ok: true, accessToken: 'tok' })
    h.getPlanStatus.mockResolvedValue({ tier: 'pro' })
    h.setPendingDisambiguation.mockResolvedValue(true)
    const result = await handleSharedNumberSms('+15550001111', 'hi')
    expect(result.resolvedSlug).toBeNull()
    expect(result.replyText).toMatch(/1\. Acme/)
    expect(result.replyText).toMatch(/2\. Globex/)
    expect(h.setPendingDisambiguation).toHaveBeenCalledWith('+15550001111', [
      { slug: 'acme', name: 'Acme' },
      { slug: 'globex', name: 'Globex' },
    ])
  })

  it('resolves to the chosen company when a pending disambiguation reply matches a valid number', async () => {
    h.findFounderByPhone.mockResolvedValue({ email: 'a@b.com' })
    h.listAppsForOwner.mockResolvedValue([
      { slug: 'acme', name: 'Acme', chatId: 'c1' },
      { slug: 'globex', name: 'Globex', chatId: 'c2' },
    ])
    h.resolveFounderCredential.mockResolvedValue({ ok: true, accessToken: 'tok' })
    h.getPlanStatus.mockResolvedValue({ tier: 'pro' })
    h.getPendingDisambiguation.mockResolvedValue([{ slug: 'acme', name: 'Acme' }, { slug: 'globex', name: 'Globex' }])
    h.clearPendingDisambiguation.mockResolvedValue(true)
    const result = await handleSharedNumberSms('+15550001111', '2')
    expect(result.resolvedSlug).toBe('globex')
    expect(h.clearPendingDisambiguation).toHaveBeenCalledWith('+15550001111')
  })

  it('re-sends the numbered list when a pending disambiguation reply is not a valid number', async () => {
    h.findFounderByPhone.mockResolvedValue({ email: 'a@b.com' })
    h.listAppsForOwner.mockResolvedValue([
      { slug: 'acme', name: 'Acme', chatId: 'c1' },
      { slug: 'globex', name: 'Globex', chatId: 'c2' },
    ])
    h.resolveFounderCredential.mockResolvedValue({ ok: true, accessToken: 'tok' })
    h.getPlanStatus.mockResolvedValue({ tier: 'pro' })
    h.getPendingDisambiguation.mockResolvedValue([{ slug: 'acme', name: 'Acme' }, { slug: 'globex', name: 'Globex' }])
    const result = await handleSharedNumberSms('+15550001111', 'banana')
    expect(result.resolvedSlug).toBeNull()
    expect(result.replyText).toMatch(/1\. Acme/)
    expect(h.clearPendingDisambiguation).not.toHaveBeenCalled()
  })

  it('never throws — a thrown lookup error degrades to the no-match reply', async () => {
    h.findFounderByPhone.mockRejectedValue(new Error('boom'))
    const result = await handleSharedNumberSms('+15550001111', 'hi')
    expect(result.resolvedSlug).toBeNull()
    expect(result.replyText).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/build/shared-cody-number.test.ts`
Expected: FAIL — module `@/lib/build/shared-cody-number` doesn't exist

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/build/shared-cody-number.ts
/**
 * Orchestration for the shared Text-Cody number (#936) — resolves an
 * inbound text on the shared number (not a dedicated per-company number) to
 * a specific company's conversation, or a clear reply explaining why not.
 *
 * Real ordering constraint: resolveFounderCredential() is keyed by company
 * SLUG, not founder email, so tier cannot be checked until at least one
 * company is known. Order here: lookup founder -> list companies -> zero
 * companies short-circuits before any tier check (nothing to be paid for)
 * -> tier resolved via the FIRST company's credential (tier is a founder-
 * level AINative plan property — any one of their companies' stored
 * credential reveals the same plan) -> gate -> disambiguate among 2+.
 */

import { findFounderByPhone } from '@/lib/build/founder-phones'
import { listAppsForOwner } from '@/lib/build/app-registry'
import { resolveFounderCredential } from '@/lib/build/primitive-credentials'
import { getPlanStatus, isPaidTier } from '@/lib/ainative/plan'
import { getPendingDisambiguation, setPendingDisambiguation, clearPendingDisambiguation } from '@/lib/build/sms-disambiguation'

export interface SharedNumberResult {
  replyText: string | null
  resolvedSlug: string | null
  resolvedOwnerEmail: string | null
}

const NO_MATCH_REPLY = "Text us from the phone number on your AINative account, or sign up at builder.ainative.studio"
const NO_COMPANIES_REPLY = "You don't have any companies yet — head to builder.ainative.studio to start one."
const NOT_PAID_REPLY = "Texting Cody is a paid-plan feature — upgrade at builder.ainative.studio to turn this on."

function noMatch(): SharedNumberResult {
  return { replyText: NO_MATCH_REPLY, resolvedSlug: null, resolvedOwnerEmail: null }
}

function disambiguationPrompt(companies: Array<{ slug: string; name: string }>): string {
  return `Which company? Reply with a number:\n${companies.map((c, i) => `${i + 1}. ${c.name}`).join('\n')}`
}

export async function handleSharedNumberSms(from: string, body: string): Promise<SharedNumberResult> {
  try {
    const founder = await findFounderByPhone(from)
    if (!founder) return noMatch()

    const companies = await listAppsForOwner(founder.email)
    if (companies.length === 0) {
      return { replyText: NO_COMPANIES_REPLY, resolvedSlug: null, resolvedOwnerEmail: null }
    }

    // Tier check via the first company's stored credential (any company's
    // credential reveals the same founder-level plan).
    const cred = await resolveFounderCredential(companies[0].slug, 'zerovoice')
    let paid = false
    if (cred.ok && cred.accessToken) {
      try {
        const status = await getPlanStatus(cred.accessToken)
        paid = isPaidTier(status.tier)
      } catch {
        paid = false // fail closed
      }
    }
    if (!paid) {
      return { replyText: NOT_PAID_REPLY, resolvedSlug: null, resolvedOwnerEmail: null }
    }

    if (companies.length === 1) {
      return { replyText: null, resolvedSlug: companies[0].slug, resolvedOwnerEmail: founder.email }
    }

    // 2+ companies: check for a pending disambiguation reply first.
    const pending = await getPendingDisambiguation(from)
    if (pending) {
      const trimmed = body.trim()
      const choice = /^\d+$/.test(trimmed) ? parseInt(trimmed, 10) : null
      if (choice !== null && choice >= 1 && choice <= pending.length) {
        const chosen = pending[choice - 1]
        await clearPendingDisambiguation(from)
        return { replyText: null, resolvedSlug: chosen.slug, resolvedOwnerEmail: founder.email }
      }
      // Invalid reply — re-send the SAME pending list, don't silently fail.
      return { replyText: disambiguationPrompt(pending), resolvedSlug: null, resolvedOwnerEmail: null }
    }

    // No pending state yet — this is the founder's first text: ask.
    const list = companies.map((c) => ({ slug: c.slug, name: c.name || c.slug }))
    await setPendingDisambiguation(from, list)
    return { replyText: disambiguationPrompt(list), resolvedSlug: null, resolvedOwnerEmail: null }
  } catch {
    return noMatch()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/build/shared-cody-number.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/build/shared-cody-number.ts __tests__/lib/build/shared-cody-number.test.ts
git commit -m "feat(sms): shared-number conversation orchestration (#936)"
```

---

## Task 4: Wire the shared-number branch into the real webhook route

**Files:**
- Modify: `app/api/webhooks/zerovoice-sms/route.ts`
- Test: `__tests__/api/zerovoice-sms-shared-number.test.ts` (new)

**Interfaces:**
- Consumes: `handleSharedNumberSms(from, body): Promise<SharedNumberResult>` (Task 3). Also needs `lib/build/otp.ts`'s existing direct-Twilio send mechanism (currently the module-private `sendSharedOtpSms`, not exported) — Step 1 below exports and renames it to `sendSharedSms` (the function sends any SMS from the shared number via direct Twilio, not only OTP codes, so the old name undersold what it now does for two callers).
- Produces: nothing new exported — this task only modifies the route's internal `handleInboundSms` function.

- [ ] **Step 1: Export the existing Twilio send function for reuse**

In `lib/build/otp.ts`, change:
```typescript
async function sendSharedOtpSms(toE164Number: string, body: string): Promise<SharedSmsResult> {
```
to:
```typescript
export async function sendSharedSms(toE164Number: string, body: string): Promise<SharedSmsResult> {
```
(renamed from `sendSharedOtpSms` to `sendSharedSms` — this function sends ANY SMS from the shared number via direct Twilio, not only OTP codes; the old name undersold what it now needs to do for two callers.)

Update the one existing call site in the same file (`sendOtp`'s call to `sendSharedOtpSms`) to use the new name `sendSharedSms`.

Also export `SharedSmsResult`:
```typescript
export interface SharedSmsResult {
```

- [ ] **Step 2: Run the existing OTP test suite to confirm the rename didn't break anything**

Run: `npx vitest run __tests__/lib/build/otp.test.ts`
Expected: PASS (all existing tests still pass — this is a pure rename + export, no behavior change)

- [ ] **Step 3: Write the failing integration test for the new route branch**

```typescript
// __tests__/api/zerovoice-sms-shared-number.test.ts
/**
 * #936 — the shared-number branch inside handleInboundSms. Core and all
 * shared-number/credential/tier logic are mocked; this test only verifies
 * the ROUTING decision (shared-number path tried only on a dedicated-number
 * miss) and that a resolved company flows into the same askCody()+reply
 * pipeline the dedicated-number path already uses.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  resolveAppByZeroVoiceNumber: vi.fn(),
  handleSharedNumberSms: vi.fn(),
  sendSharedSms: vi.fn(),
  askCody: vi.fn(),
  resolveFounderCredential: vi.fn(),
  sendZeroVoiceSms: vi.fn(),
}))

vi.mock('@/lib/build/app-registry', () => ({ resolveAppByZeroVoiceNumber: h.resolveAppByZeroVoiceNumber }))
vi.mock('@/lib/build/shared-cody-number', () => ({ handleSharedNumberSms: h.handleSharedNumberSms }))
vi.mock('@/lib/build/otp', () => ({ sendSharedSms: h.sendSharedSms }))
vi.mock('@/app/api/build/ask/route', () => ({ askCody: h.askCody }))
vi.mock('@/lib/build/primitive-credentials', () => ({ resolveFounderCredential: h.resolveFounderCredential }))
vi.mock('@/lib/build/zerovoice', () => ({ sendZeroVoiceSms: h.sendZeroVoiceSms }))
vi.mock('@/lib/git/gitea-client', () => ({ createIssue: vi.fn() }))

process.env.ZEROVOICE_SMS_WEBHOOK_SECRET = 'test-secret'
process.env.ZEROVOICE_SHARED_NUMBER = '+19377642838'

import { POST } from '@/app/api/webhooks/zerovoice-sms/route'

function req(payload: Record<string, unknown>) {
  return {
    headers: { get: (k: string) => (k.toLowerCase() === 'x-builder-webhook-secret' ? 'test-secret' : null) },
    text: async () => JSON.stringify(payload),
  } as any
}

beforeEach(() => { Object.values(h).forEach((fn) => fn.mockReset()) })
afterEach(() => vi.restoreAllMocks())

describe('POST /api/webhooks/zerovoice-sms — shared-number routing (#936)', () => {
  it('tries the shared-number path ONLY when the dedicated-number lookup misses', async () => {
    h.resolveAppByZeroVoiceNumber.mockResolvedValue({ slug: 'acme', ownerEmail: 'a@b.com', gitOrg: null }) // a real match
    const res = await POST(req({ To: '+19377642838', From: '+15550001111', Body: 'hi' }))
    expect(h.handleSharedNumberSms).not.toHaveBeenCalled()
  })

  it('does not try the shared-number path for a To that is neither a dedicated number NOR the shared number', async () => {
    h.resolveAppByZeroVoiceNumber.mockResolvedValue(null)
    const res = await POST(req({ To: '+15559998888', From: '+15550001111', Body: 'hi' }))
    expect(h.handleSharedNumberSms).not.toHaveBeenCalled()
    const data = await res.json()
    expect(data.reason).toBe('no_matching_company')
  })

  it('sends the replyText directly via sendSharedSms when handleSharedNumberSms returns a non-null reply (no company resolved)', async () => {
    h.resolveAppByZeroVoiceNumber.mockResolvedValue(null)
    h.handleSharedNumberSms.mockResolvedValue({ replyText: 'Upgrade required.', resolvedSlug: null, resolvedOwnerEmail: null })
    h.sendSharedSms.mockResolvedValue({ ok: true })
    const res = await POST(req({ To: '+19377642838', From: '+15550001111', Body: 'hi' }))
    expect(h.sendSharedSms).toHaveBeenCalledWith('+15550001111', 'Upgrade required.')
    expect(h.askCody).not.toHaveBeenCalled()
  })

  it('runs askCody() and sends ITS reply via sendSharedSms when a company IS resolved', async () => {
    h.resolveAppByZeroVoiceNumber.mockResolvedValue(null)
    h.handleSharedNumberSms.mockResolvedValue({ replyText: null, resolvedSlug: 'acme', resolvedOwnerEmail: 'a@b.com' })
    h.askCody.mockResolvedValue({ answer: 'Your app is live.' })
    h.sendSharedSms.mockResolvedValue({ ok: true })
    const res = await POST(req({ To: '+19377642838', From: '+15550001111', Body: 'what is my status' }))
    expect(h.askCody).toHaveBeenCalled()
    expect(h.sendSharedSms).toHaveBeenCalledWith('+15550001111', 'Your app is live.')
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run __tests__/api/zerovoice-sms-shared-number.test.ts`
Expected: FAIL — the route has no shared-number branch yet, so `handleSharedNumberSms`/`sendSharedSms` are never called in any of these scenarios (the mock-call assertions fail)

- [ ] **Step 5: Implement the route change**

In `app/api/webhooks/zerovoice-sms/route.ts`:

Add imports:
```typescript
import { handleSharedNumberSms } from '@/lib/build/shared-cody-number'
import { sendSharedSms } from '@/lib/build/otp'
```

Add the constant near `WEBHOOK_SECRET`:
```typescript
const SHARED_NUMBER = process.env.ZEROVOICE_SHARED_NUMBER || '+19377642838'
```

Find this existing block inside `handleInboundSms` (right after `const from = ...` / `const body = ...` are derived, BEFORE the existing `resolveAppByZeroVoiceNumber` call):

```typescript
  // Never have a conversation for a company with no verified, positively-
  // matched inbound number — no default/fallback company, ever.
  const app = await resolveAppByZeroVoiceNumber(to).catch((e) => {
    console.error('[zerovoice-sms-webhook] resolveAppByZeroVoiceNumber threw:', e)
    return null
  })
  if (!app) {
    console.error(`[zerovoice-sms-webhook] no company matched inbound number ${to} — no-op, not filing against any fallback`)
    return { ok: false, reason: 'no_matching_company' }
  }
```

Replace the `if (!app) { ... }` block with a new branch that tries the shared number before giving up:

```typescript
  if (!app) {
    // #936 — the shared, paid-tier Text-Cody number is a SEPARATE, additive
    // routing mode, tried only on a dedicated-number miss. The existing
    // "no fallback company, ever" invariant above is unchanged for every
    // dedicated number — this branch only ever fires for SHARED_NUMBER.
    if (to === SHARED_NUMBER) {
      const shared = await handleSharedNumberSms(from, body).catch((e) => {
        console.error('[zerovoice-sms-webhook] handleSharedNumberSms threw:', e)
        return { replyText: null, resolvedSlug: null, resolvedOwnerEmail: null }
      })
      if (!shared.resolvedSlug) {
        if (shared.replyText) {
          const sendResult = await sendSharedSms(from, shared.replyText).catch((e) => {
            console.error('[zerovoice-sms-webhook] sendSharedSms (shared-number reply) threw:', e)
            return { ok: false, reason: 'threw' }
          })
          if (!sendResult.ok) {
            console.error('[zerovoice-sms-webhook] shared-number reply send failed:', sendResult.reason)
          }
        }
        return { ok: false, reason: 'shared_number_no_company_resolved' }
      }
      // A company WAS resolved via the shared number — run the exact same
      // askCody() + reply pipeline the dedicated-number path below uses,
      // just addressed to `from` via the shared number instead of a
      // per-company founder-owned number. Lookup is by SLUG here (not by
      // number, since the shared number isn't any one company's own) —
      // resolveApp() already exists in app-registry.ts for this exact case
      // (e.g. app/api/build/zerovoice/route.ts uses it the same way).
      const companyApp = await resolveApp(shared.resolvedSlug).catch(() => null)
      if (!companyApp) {
        return { ok: false, reason: 'shared_number_company_not_found' }
      }
      if (!body) return { ok: false, reason: 'empty_body' }

      const ownerKey = shared.resolvedOwnerEmail ? shared.resolvedOwnerEmail.trim().toLowerCase() : 'guest:anon'
      const scopeKey = chatScopeKey(ownerKey, companyApp.slug)
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://builder.ainative.studio'

      const result = await askCody({
        question: body,
        idea: companyApp.idea || '',
        companyName: companyApp.name || companyApp.slug,
        track: companyApp.track === 'app' ? 'app' : 'company',
        companyId: companyApp.slug,
        scopeKey,
        tier: 'pro', // already gated paid upstream in handleSharedNumberSms — a literal non-hobbyist tier here only affects askCody's own internal tier-based behavior, not re-checked billing
        baseUrl,
      }).catch((e) => {
        console.error('[zerovoice-sms-webhook] askCody (shared-number path) threw:', e)
        return null
      })

      const editTriggered = Boolean(companyApp.gitOrg && detectEditIntent(body))
      const replyText = result && 'answer' in result && result.answer
        ? result.answer.slice(0, MAX_REPLY_CHARS)
        : "Sorry, I couldn't process that just now — text me again in a bit?"

      const sendResult = await sendSharedSms(from, replyText).catch((e) => {
        console.error('[zerovoice-sms-webhook] sendSharedSms (shared-number answer) threw:', e)
        return { ok: false, reason: 'threw' }
      })
      if (!sendResult.ok) {
        console.error('[zerovoice-sms-webhook] shared-number answer send failed:', sendResult.reason)
      }

      return { ok: Boolean(result && 'answer' in result), reason: result && 'answer' in result ? 'replied' : 'fallback_logged', editTriggered }
    }

    console.error(`[zerovoice-sms-webhook] no company matched inbound number ${to} — no-op, not filing against any fallback`)
    return { ok: false, reason: 'no_matching_company' }
  }
```

**Implementer note:** add `resolveApp` to this file's existing `import { resolveAppByZeroVoiceNumber } from '@/lib/build/app-registry'` line, making it `import { resolveAppByZeroVoiceNumber, resolveApp } from '@/lib/build/app-registry'`.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run __tests__/api/zerovoice-sms-shared-number.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 7: Run the FULL existing webhook test suite to confirm the dedicated-number path is untouched**

Run: `npx vitest run __tests__/api/*zerovoice-sms*`
Expected: PASS — every existing test for the dedicated-number path (#744, #616) still passes unchanged

- [ ] **Step 8: Commit**

```bash
git add app/api/webhooks/zerovoice-sms/route.ts lib/build/otp.ts __tests__/api/zerovoice-sms-shared-number.test.ts __tests__/lib/build/otp.test.ts
git commit -m "feat(sms): wire shared-number routing into the real inbound webhook (#936)"
```

---

## Task 5: Dashboard UI card

**Files:**
- Create: `components/build/TextCodyCard.tsx`
- Modify: `components/build/screens/Live.tsx` (mount the new card near `ZeroVoiceConnect`)
- Test: `__tests__/components/build/TextCodyCard.test.tsx` (new)

**Interfaces:**
- Consumes: `isPaidTier` pattern — this component receives tier/paid status as a prop from its parent (`Live.tsx`), matching how `ZeroVoiceConnect` receives `signedIn`/`e164` as props rather than fetching its own auth state
- Produces: nothing new exported beyond the component itself

**Confirmed real pattern** (checked directly against `components/build/screens/Live.tsx:1267-1272`): `ZeroVoiceConnect` receives NO tier prop at all —

```tsx
<ZeroVoiceConnect
  companyId={companyId}
  signedIn={signedIn}
  e164={zerovoiceE164}
  onRequireAuth={() => dispatch({ type: 'GOTO_SCREEN', screen: 'signup' })}
/>
```

— matching its own doc comment ("Removed the client-side gate entirely; the real tier check happens exactly once, server-side, on every click"). `TextCodyCard` follows the SAME pattern: no tier prop, renders unconditionally — the real paid-tier gate lives entirely server-side in `lib/build/shared-cody-number.ts` (Task 3), on the inbound SMS itself. This simplifies `TextCodyCard` to a prop-free component.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/components/build/TextCodyCard.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

import { TextCodyCard } from '@/components/build/TextCodyCard'

let host: HTMLElement
let root: Root
function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

describe('TextCodyCard', () => {
  it('displays the real shared number, formatted for readability', () => {
    render(React.createElement(TextCodyCard))
    expect(host.textContent).toMatch(/\(937\)\s*764-2838/)
  })

  it('carries the same SMS consent disclosure language as ZeroVoiceConnect', () => {
    render(React.createElement(TextCodyCard))
    expect(host.textContent).toMatch(/agree to receive SMS replies from Cody/i)
    expect(host.querySelector('a[href*="sms-terms"]')).toBeTruthy()
  })

  it('renders no action button — nothing to provision, the number already exists', () => {
    render(React.createElement(TextCodyCard))
    expect(host.querySelectorAll('button').length).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/components/build/TextCodyCard.test.tsx`
Expected: FAIL — module `@/components/build/TextCodyCard` doesn't exist

- [ ] **Step 3: Write minimal implementation**

```typescript
// components/build/TextCodyCard.tsx
'use client'

/**
 * TextCodyCard (#936) — surfaces AINative's shared, already-wired
 * Text-Cody number on the dashboard. Unlike ZeroVoiceConnect (which
 * provisions a NEW, company-owned number), there is nothing to provision
 * here — the shared number already exists and is already wired
 * (app/api/webhooks/zerovoice-sms/route.ts's shared-number branch). This is
 * purely informational, matching ZeroVoiceConnect's own no-client-tier-gate
 * pattern (the real tier check happens server-side, on the inbound SMS
 * itself, in lib/build/shared-cody-number.ts).
 */

const SHARED_NUMBER_DISPLAY = '(937) 764-2838'

export function TextCodyCard() {
  return (
    <div className="m-system m-system-static" data-testid="text-cody-card">
      <span className="m-system-name">Text Cody</span>
      <span className="m-system-stat m-mono" data-testid="text-cody-number">
        {SHARED_NUMBER_DISPLAY} — text Cody anytime, on the go
      </span>
      <span className="m-chip m-system-prim">ZeroVoice</span>
      <p className="m-mono m-metric-note" data-testid="text-cody-sms-consent">
        By texting this number, you agree to receive SMS replies from Cody.
        Msg &amp; data rates may apply. Reply STOP to opt out, HELP for help. See{' '}
        <a href="https://zerovoice-frontend-production.up.railway.app/sms-terms" target="_blank" rel="noreferrer">
          SMS Program Terms
        </a>.
      </p>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/components/build/TextCodyCard.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Mount the card in Live.tsx, next to ZeroVoiceConnect**

Add the import near the other `components/build/*` imports (alongside the existing `import { ZeroVoiceConnect } from '@/components/build/ZeroVoiceConnect'` at line 38):

```typescript
import { TextCodyCard } from '@/components/build/TextCodyCard'
```

Then modify the exact JSX block at `components/build/screens/Live.tsx:1264-1272` from:

```tsx
            {/* Get a phone number (2026-09-16) — the real backend
                (/api/build/zerovoice, correctly tier-gated to ANY paid plan)
                existed with no dashboard entry point at all until now. */}
            <ZeroVoiceConnect
              companyId={companyId}
              signedIn={signedIn}
              e164={zerovoiceE164}
              onRequireAuth={() => dispatch({ type: 'GOTO_SCREEN', screen: 'signup' })}
            />
```

to:

```tsx
            {/* Get a phone number (2026-09-16) — the real backend
                (/api/build/zerovoice, correctly tier-gated to ANY paid plan)
                existed with no dashboard entry point at all until now. */}
            <ZeroVoiceConnect
              companyId={companyId}
              signedIn={signedIn}
              e164={zerovoiceE164}
              onRequireAuth={() => dispatch({ type: 'GOTO_SCREEN', screen: 'signup' })}
            />
            {/* Shared Text-Cody number (#936) — no provisioning needed, the
                number already exists; paid-tier gate is server-side on the
                inbound SMS itself (lib/build/shared-cody-number.ts). */}
            <TextCodyCard />
```

- [ ] **Step 6: Run the real Live-screen test files to confirm no regression**

This codebase has many small, focused `live-*` test files rather than one monolithic `Live.test.tsx` — run them all:

Run: `npx vitest run __tests__/components/build/live-*.test.ts __tests__/lib/build/live-*.test.ts`
Expected: PASS — no regressions (this is a pure additive JSX change, one new sibling element)

- [ ] **Step 7: Commit**

```bash
git add components/build/TextCodyCard.tsx components/build/screens/Live.tsx __tests__/components/build/TextCodyCard.test.tsx
git commit -m "feat(dashboard): add TextCodyCard surfacing the shared number (#936)"
```

---

## Task 6: Full-suite verification, env var, and live deploy prep

**Files:** none new — this task is verification + configuration only.

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass (check for the pre-existing flaky `task-git-sync-356.test.ts` timing test specifically — if ONLY that one fails, re-run it in isolation to confirm it's the known flake, not a real regression, per this session's own prior precedent)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, no errors

- [ ] **Step 3: Set the shared-number env var on Railway (if not already defaulted correctly in code)**

Since the code defaults `ZEROVOICE_SHARED_NUMBER` to the literal `+19377642838` when unset (Task 4, Step 5), this step is OPTIONAL — only needed if the team wants it explicitly configurable without a redeploy later:

```bash
railway variables --service builder-ainative-studio --set "ZEROVOICE_SHARED_NUMBER=+19377642838"
```

- [ ] **Step 4: Push the branch and open the PR, referencing #936**

```bash
git push -u origin <branch-name>
gh pr create --repo AINative-Studio/builder-ainative-studio \
  --title "feat(sms): shared paid-tier Text-Cody number" \
  --body "Implements #936 per the merged design spec (docs/superpowers/specs/2026-10-05-shared-cody-number-design.md). See individual commits for the 5-task breakdown (phone lookup, disambiguation store, orchestration module, webhook routing, dashboard card)." \
  --base main
```

- [ ] **Step 5: Wait for CI, merge once green**

```bash
gh pr checks <pr-number> --repo AINative-Studio/builder-ainative-studio
# once all pass:
gh pr merge <pr-number> --repo AINative-Studio/builder-ainative-studio --squash --delete-branch
```

- [ ] **Step 6: Wait for the Railway deploy to land, confirm via /api/health**

```bash
# get the real merge commit SHA first
git log origin/main --oneline -3
# then poll until it matches:
curl -s https://builder.ainative.studio/api/health
```

- [ ] **Step 7: Live-verify end-to-end**

This requires a REAL test account on a REAL paid tier with a REAL verified phone number — not fabricatable from a fresh test signup, since paid-tier status and phone verification both require real state. Options, in order of preference:
1. Use the founder's own real paid account + a real test phone number they control, OR
2. Manually set a disposable test account's phone as `verified: true` in `builder_founder_phones` via direct ZeroDB write (same pattern used earlier this session for live-verifying OTP), AND manually ensure that account resolves to a paid tier (check with the founder which real or test account to use before writing anything).

Real verification steps once a usable account exists:
- Send a real SMS to `+19377642838` from the verified phone, body: "hello"
- Confirm a real reply arrives (single-company case: Cody's real answer; multi-company case: the numbered list)
- If multi-company: reply with a number, confirm the SAME conversation context the dashboard chat for that company would show
- Confirm via Railway logs (`railway logs --service builder-ainative-studio`) that `handleSharedNumberSms` was reached and resolved a real slug, not silently falling through to `no_matching_company`

Report the real evidence (log lines, actual received SMS content) — do not report this task complete on code-review alone, consistent with this session's own established verification discipline.
