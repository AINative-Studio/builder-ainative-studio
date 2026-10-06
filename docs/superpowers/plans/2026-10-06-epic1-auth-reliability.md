# Epic 1 (Auth and Reliability) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the real remaining work from Epic 1 of the Oct 2026 backlog — release what CAN actually be released when a founder deletes a company (ZeroVoice number + BYO domain, confirmed real API support; ZeroDB and purchased domains confirmed to have NO release API anywhere and are explicitly out of scope, see Task 1), add a real email-code fallback alongside the existing phone-OTP flow, speed up delivery-failure detection using Twilio's real status callback, and alert the team when SMS delivery genuinely fails.

**Architecture:** Each task extends an existing, already-identified module rather than introducing new subsystems — `lib/build/danger-zone.ts` gains a best-effort resource-release step before its existing lifecycle flip; `lib/build/otp.ts` gains a second, email-based send path reusing the existing generic Resend client; a new Twilio status-callback webhook route feeds a faster failure signal into the same OTP UI state `#950/#951` already built; the existing, already-wired Slack alerting module (`lib/jobs/alerting.ts`) gains one more alert rule.

**Tech Stack:** Next.js 15 App Router, TypeScript, Vitest — confirmed as the real stack (NOT the Python/FastAPI the source doc assumed; see spec's Stack Conflict section).

**Spec:** `docs/superpowers/specs/2026-10-06-epic1-auth-reliability-design.md`

## Global Constraints

- One GitHub issue per task, filed before any code for that task (repo's own "No Code Without An Issue" rule) — each task's steps include filing it.
- Real TDD per task: RED test written and run (watch it fail for the stated reason), then minimal GREEN, never skip either half.
- `npx tsc --noEmit` clean after every task.
- `npx vitest run` (full suite) green after every task — one known pre-existing flake, `__tests__/lib/build/task-splitter.test.ts` (a CPU-contention / `vi.spyOn`-module-caching race, confirmed harmless in isolation across ~8 PRs this session already) — if ONLY that single test fails, rerun it alone to confirm it passes isolated, ledger it as the known flake, and move on; do not spend time re-diagnosing it.
- Real PR per task, referencing its issue number, merged only after CI passes.
- Real Railway deploy verification after merge: `curl -s https://builder.ainative.studio/api/health` until its `version` field matches the new merge commit SHA.
- Genuine human-style Chrome-browser verification (not just API/unit-test checks) for anything user-facing, before a task counts as done — this repo's own established practice this session.
- Never fabricate a working API call against an endpoint that hasn't been confirmed to exist. Task 1 found real, confirmed endpoints for 2 of 4 originally-scoped resources and confirmed NO endpoint exists for the other 2 — ship exactly what's real; do not simulate, stub, or silently no-op the unsupported ones as if they worked.

## Review Focus

- A company with NO provisioned ZeroVoice number or BYO domain (the common case — most companies never provision either) must delete cleanly with zero release attempts, not error or hang waiting on resources that were never there.
- A release call that times out or 5xxs must never block the lifecycle flip to `'deleted'` — the founder-visible "it's gone" outcome must land even when Railway or ZeroVoice is down.
- The email-OTP fallback must use the SAME `builder_otp_codes` ZeroDB table and verification path as phone-OTP (not a parallel, divergent code-verification system) — a code sent by email must verify through the exact same `verifyOtp()` function phone codes already use.
- A Twilio status-callback hit for a DIFFERENT send (any other outbound SMS this codebase sends, e.g. the shared Text-Cody number from #936/#947) must never be mistaken for an OTP delivery-failure signal — the callback handler must positively identify "this status update is about an OTP send," not assume every callback hit is one.
- The Slack alert for SMS failures must respect the existing 5-minute cooldown (`shouldSendAlert` in `lib/jobs/alerting.ts`) — a carrier-wide outage (like the real, ongoing A2P 10DLC block this session already found) must not spam the channel once per failed send.

---

### Task 1: Release ZeroVoice number and BYO domain on company delete

**Files:**
- Modify: `lib/build/zerovoice.ts` (add `releaseZeroVoiceNumber`)
- Modify: `lib/build/railway-deploy.ts` (add `deleteCustomDomain`)
- Modify: `lib/build/danger-zone.ts` (wire both into `applyDangerAction`'s `'delete'` case)
- Modify: `app/api/build/danger/route.ts` (pass the founder's real JWT through)
- Test: `__tests__/lib/build/zerovoice-release-number.test.ts`
- Test: `__tests__/lib/build/railway-delete-custom-domain.test.ts`
- Test: `__tests__/lib/danger-zone-resource-release.test.ts`

**Interfaces:**
- Consumes: `AppEntry` (`lib/build/app-registry.ts`) fields `zerovoiceNumberId?: string`, `byoDomainId?: string`, `domain?: string` (purchased — confirmed OUT OF SCOPE, see below), `zerodbProjectId?: string` (confirmed OUT OF SCOPE, see below).
- Produces: `releaseZeroVoiceNumber(jwt: string, numberId: string): Promise<{ok: boolean; reason?: string; status?: number}>`, `deleteCustomDomain(domainId: string): Promise<{ok: boolean; reason?: string}>`, both consumed by `applyDangerAction`'s extended `'delete'` case, which later tasks (none in this plan) could further extend.

**Confirmed real API support (verified live against the actual production APIs before writing this task — do not re-verify, these are facts):**
- ZeroVoice: `DELETE https://zerovoice-production.up.railway.app/api/v1/numbers/{number_id}` — confirmed present in ZeroVoice's real, live OpenAPI spec (`curl -s https://zerovoice-production.up.railway.app/openapi.json`). Buildable.
- Railway: GraphQL mutation `customDomainDelete` — confirmed present in Railway's real GraphQL schema (introspection query against `https://backboard.railway.com/graphql/v2`). Buildable.
- **ZeroDB Instant DB has NO delete/teardown endpoint anywhere** — confirmed via core's real OpenAPI spec (`curl -s https://api.ainative.studio/openapi.json`): only `POST /api/v1/public/instant-db`, `POST /api/v1/public/instant-db/claim`, `POST /api/v1/public/instant-db/send-claim-email` exist. A direct `DELETE` probe against a real project id returned a route-level 404 ("Not found"), not an auth/validation error. **Do not build this.** Leave `zerodbProjectId` unreleased; this is a real, confirmed gap in core's own API surface, not something fixable from this repo.
- **Purchased domains (`domain` field) have NO delete endpoint either** — core's real OpenAPI spec has only `.../domains/suggest|check|health|register|purchase|fulfill` (all GET/POST, no DELETE). The one domain-DELETE route that DOES exist, `DELETE /api/v1/workspace/domain`, is a workspace-SSO-domain-verification feature (confirmed by its sibling routes `/workspace/domain/request|verify|status`) — a completely different subsystem from a founder's purchased registrar domain, and not a safe substitute. Releasing a real purchased domain is a registrar-level operation (refund windows, transfer locks) that doesn't reduce to one API call. **Do not build this either.**

**This task's real, honest scope is therefore: release the ZeroVoice number and the BYO domain Railway wiring — the two resources with a confirmed real release API — and leave ZeroDB projects and purchased domains explicitly unreleased, documented as a known gap in the PR description (not silently dropped).**

- [ ] **Step 1: File the GitHub issue**

```bash
gh issue create --repo AINative-Studio/builder-ainative-studio \
  --title "feat(danger-zone): release ZeroVoice number and BYO domain wiring on company delete" \
  --body "Part of Epic 1 (SEP-02). Deleting a company today only soft-deletes (stops the nightly loop, flips a lifecycle flag) -- confirmed via code read that NO provisioned resource is ever released. This issue covers the two resources with a confirmed real release API: the ZeroVoice phone number (DELETE /api/v1/numbers/{id}, confirmed present in ZeroVoice's live OpenAPI spec) and BYO domain Railway wiring (customDomainDelete, confirmed present in Railway's live GraphQL schema). ZeroDB Instant DB projects and purchased domains have NO delete endpoint anywhere in their real APIs (verified directly) -- out of scope for this issue, left as a documented gap." \
  --label "enhancement"
```

Note the returned issue number for the commit/PR below.

- [ ] **Step 2: Write the failing test for `releaseZeroVoiceNumber`**

```typescript
// __tests__/lib/build/zerovoice-release-number.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('releaseZeroVoiceNumber', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('calls DELETE on the real numbers endpoint with the founder JWT', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => ({}) })
    const { releaseZeroVoiceNumber } = await import('@/lib/build/zerovoice')
    const result = await releaseZeroVoiceNumber('real-jwt-token', 'num_abc123')
    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/numbers/num_abc123'),
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ Authorization: 'Bearer real-jwt-token' }),
      }),
    )
  })

  it('reports the real reason on a non-2xx response, never throws', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({ detail: 'number not found' }) })
    const { releaseZeroVoiceNumber } = await import('@/lib/build/zerovoice')
    const result = await releaseZeroVoiceNumber('real-jwt-token', 'num_missing')
    expect(result.ok).toBe(false)
    expect(result.status).toBe(404)
    expect(result.reason).toContain('number not found')
  })

  it('fails closed on a network error, never throws past the caller', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'))
    const { releaseZeroVoiceNumber } = await import('@/lib/build/zerovoice')
    const result = await releaseZeroVoiceNumber('real-jwt-token', 'num_abc123')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('ECONNRESET')
  })

  it('returns ok:false with reason "no_jwt" when no JWT is given, without calling fetch', async () => {
    const { releaseZeroVoiceNumber } = await import('@/lib/build/zerovoice')
    const result = await releaseZeroVoiceNumber('', 'num_abc123')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_jwt')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2b: Run it to verify it fails**

Run: `npx vitest run __tests__/lib/build/zerovoice-release-number.test.ts`
Expected: FAIL — `releaseZeroVoiceNumber is not a function` (does not exist yet in `lib/build/zerovoice.ts`).

- [ ] **Step 3: Implement `releaseZeroVoiceNumber`**

Add to `lib/build/zerovoice.ts`, directly below the existing `provisionZeroVoiceNumber` function (mirrors its exact error-handling shape — `ZV_BASE` is already defined at the top of this file, do not redefine it):

```typescript
export interface ZeroVoiceReleaseResult {
  ok: boolean
  reason?: string
  status?: number
}

/**
 * Release a provisioned ZeroVoice number on company delete (#SEP-02). Mirrors
 * provisionZeroVoiceNumber's own auth/error shape exactly — same JWT-bearer
 * auth, same never-throws-past-the-caller contract, since this is called from
 * the Danger Zone delete flow where a release failure must never block the
 * founder-visible delete from completing.
 */
export async function releaseZeroVoiceNumber(
  jwt: string,
  numberId: string,
): Promise<ZeroVoiceReleaseResult> {
  if (!jwt) return { ok: false, reason: 'no_jwt' }
  if (!numberId) return { ok: false, reason: 'no_number_id' }
  try {
    const res = await fetch(`${ZV_BASE}/numbers/${encodeURIComponent(numberId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${jwt}` },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      return { ok: false, status: res.status, reason: String(data?.message || data?.detail || data?.error || res.status).slice(0, 160) }
    }
    return { ok: true, status: res.status }
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e).slice(0, 160) }
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run __tests__/lib/build/zerovoice-release-number.test.ts`
Expected: PASS, 4/4.

- [ ] **Step 5: Write the failing test for `deleteCustomDomain`**

```typescript
// __tests__/lib/build/railway-delete-custom-domain.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ RAILWAY_API_TOKEN: 'real-railway-token' }))
vi.stubEnv('RAILWAY_API_TOKEN', h.RAILWAY_API_TOKEN)

describe('deleteCustomDomain', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('calls the real customDomainDelete GraphQL mutation with the domain id', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ data: { customDomainDelete: true } }),
    })
    const { deleteCustomDomain } = await import('@/lib/build/railway-deploy')
    const result = await deleteCustomDomain('cd_abc123')
    expect(result.ok).toBe(true)
    const [, opts] = fetchMock.mock.calls[0]
    const body = JSON.parse(opts.body)
    expect(body.query).toContain('customDomainDelete')
    expect(body.variables).toEqual({ id: 'cd_abc123' })
  })

  it('reports the real GraphQL error, never throws', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ errors: [{ message: 'domain not found' }] }),
    })
    const { deleteCustomDomain } = await import('@/lib/build/railway-deploy')
    const result = await deleteCustomDomain('cd_missing')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('domain not found')
  })

  it('returns ok:false with reason "no_domain_id" when no id is given, without calling fetch', async () => {
    const { deleteCustomDomain } = await import('@/lib/build/railway-deploy')
    const result = await deleteCustomDomain('')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_domain_id')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 5b: Run it to verify it fails**

Run: `npx vitest run __tests__/lib/build/railway-delete-custom-domain.test.ts`
Expected: FAIL — `deleteCustomDomain is not a function`.

- [ ] **Step 6: Implement `deleteCustomDomain`**

Add to `lib/build/railway-deploy.ts`, directly below the existing `getCustomDomainStatus` function (reuses the already-defined `railwayQuery` helper and `railwayApiConfigured()`/`railwayToken()` checks already in this file — do not redefine them):

```typescript
export interface CustomDomainDeleteResult {
  ok: boolean
  reason?: string
}

/**
 * Release a founder's BYO custom domain wiring on company delete (#SEP-02).
 * Mirrors createCustomDomain/getCustomDomainStatus's own railwayQuery usage —
 * never throws past the caller, since a release failure must never block the
 * Danger Zone delete flow from completing.
 */
export async function deleteCustomDomain(domainId: string): Promise<CustomDomainDeleteResult> {
  if (!railwayApiConfigured()) return { ok: false, reason: 'disabled' }
  if (!domainId) return { ok: false, reason: 'no_domain_id' }
  try {
    await railwayQuery(
      `mutation CustomDomainDelete($id: String!) {
        customDomainDelete(id: $id)
      }`,
      { id: domainId },
    )
    return { ok: true }
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e).slice(0, 200) }
  }
}
```

- [ ] **Step 7: Run it to verify it passes**

Run: `npx vitest run __tests__/lib/build/railway-delete-custom-domain.test.ts`
Expected: PASS, 3/3.

- [ ] **Step 8: Write the failing test for `applyDangerAction`'s extended delete behavior**

```typescript
// __tests__/lib/danger-zone-resource-release.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  setLoopEnabled: vi.fn(),
  setAppLifecycle: vi.fn(),
  resolveApp: vi.fn(),
  releaseZeroVoiceNumber: vi.fn(),
  deleteCustomDomain: vi.fn(),
}))

vi.mock('@/lib/build/loop-enrollment', () => ({ setLoopEnabled: h.setLoopEnabled }))
vi.mock('@/lib/build/app-registry', () => ({ setAppLifecycle: h.setAppLifecycle, resolveApp: h.resolveApp }))
vi.mock('@/lib/build/zerovoice', () => ({ releaseZeroVoiceNumber: h.releaseZeroVoiceNumber }))
vi.mock('@/lib/build/railway-deploy', () => ({ deleteCustomDomain: h.deleteCustomDomain }))

import { applyDangerAction } from '@/lib/build/danger-zone'

describe('applyDangerAction — delete releases provisioned resources (#SEP-02)', () => {
  beforeEach(() => {
    h.setLoopEnabled.mockReset().mockResolvedValue(true)
    h.setAppLifecycle.mockReset().mockResolvedValue(true)
    h.resolveApp.mockReset()
    h.releaseZeroVoiceNumber.mockReset()
    h.deleteCustomDomain.mockReset()
  })

  it('releases a provisioned ZeroVoice number and BYO domain, using the founder JWT', async () => {
    h.resolveApp.mockResolvedValue({
      slug: 'acme', zerovoiceNumberId: 'num_123', byoDomainId: 'cd_456',
    })
    h.releaseZeroVoiceNumber.mockResolvedValue({ ok: true })
    h.deleteCustomDomain.mockResolvedValue({ ok: true })

    const outcome = await applyDangerAction({
      action: 'delete', companyId: 'acme', companyName: 'Acme', track: 'company', slug: 'acme', confirm: 'acme',
    }, 'founder-real-jwt')

    expect(h.releaseZeroVoiceNumber).toHaveBeenCalledWith('founder-real-jwt', 'num_123')
    expect(h.deleteCustomDomain).toHaveBeenCalledWith('cd_456')
    expect(outcome.ok).toBe(true)
    expect(outcome.zerovoiceReleased).toBe(true)
    expect(outcome.byoDomainReleased).toBe(true)
    expect(outcome.lifecycleChanged).toBe(true)
  })

  it('skips release calls entirely for a company with neither resource provisioned', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'acme' })

    const outcome = await applyDangerAction({
      action: 'delete', companyId: 'acme', companyName: 'Acme', track: 'company', slug: 'acme', confirm: 'acme',
    }, 'founder-real-jwt')

    expect(h.releaseZeroVoiceNumber).not.toHaveBeenCalled()
    expect(h.deleteCustomDomain).not.toHaveBeenCalled()
    expect(outcome.ok).toBe(true)
    expect(outcome.lifecycleChanged).toBe(true)
  })

  it('still completes the delete (lifecycle flip) when a release call fails', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'acme', zerovoiceNumberId: 'num_123' })
    h.releaseZeroVoiceNumber.mockResolvedValue({ ok: false, reason: 'timeout' })

    const outcome = await applyDangerAction({
      action: 'delete', companyId: 'acme', companyName: 'Acme', track: 'company', slug: 'acme', confirm: 'acme',
    }, 'founder-real-jwt')

    expect(outcome.ok).toBe(true)
    expect(outcome.lifecycleChanged).toBe(true)
    expect(outcome.zerovoiceReleased).toBe(false)
  })

  it('pause/resume/offline actions are unaffected — no release calls, same as before', async () => {
    const outcome = await applyDangerAction({
      action: 'pause', companyId: 'acme', companyName: 'Acme', track: 'company', slug: 'acme', confirm: '',
    }, 'founder-real-jwt')
    expect(h.releaseZeroVoiceNumber).not.toHaveBeenCalled()
    expect(h.deleteCustomDomain).not.toHaveBeenCalled()
    expect(outcome.ok).toBe(true)
  })
})
```

- [ ] **Step 8b: Run it to verify it fails**

Run: `npx vitest run __tests__/lib/danger-zone-resource-release.test.ts`
Expected: FAIL — `applyDangerAction` currently takes one argument, not two (`founder-real-jwt` is unused/ignored), and `resolveApp`/`releaseZeroVoiceNumber`/`deleteCustomDomain` are never called from the `'delete'` case today, so the first three tests fail on the `expect(...).toHaveBeenCalledWith(...)`/`.toBe(true)` assertions for the release-related fields.

- [ ] **Step 9: Extend `applyDangerAction`**

Modify `lib/build/danger-zone.ts`:

```typescript
import { setLoopEnabled } from '@/lib/build/loop-enrollment'
import { setAppLifecycle, resolveApp } from '@/lib/build/app-registry'
import { releaseZeroVoiceNumber } from '@/lib/build/zerovoice'
import { deleteCustomDomain } from '@/lib/build/railway-deploy'
```

Replace the existing `DangerOutcome` interface and `'delete'` case:

```typescript
export interface DangerOutcome {
  ok: boolean
  action: DangerAction
  loopChanged?: boolean
  lifecycleChanged?: boolean
  zerovoiceReleased?: boolean
  byoDomainReleased?: boolean
  detail?: string
}

export async function applyDangerAction(req: DangerRequest, founderJwt?: string): Promise<DangerOutcome> {
  switch (req.action) {
    case 'pause': {
      const loopChanged = await setLoopEnabled(req.companyId, req.companyName, req.track, false)
      return { ok: true, action: 'pause', loopChanged }
    }
    case 'resume': {
      const loopChanged = await setLoopEnabled(req.companyId, req.companyName, req.track, true)
      return { ok: true, action: 'resume', loopChanged }
    }
    case 'offline': {
      const lifecycleChanged = await setAppLifecycle(req.slug, 'offline')
      return { ok: true, action: 'offline', lifecycleChanged }
    }
    case 'delete': {
      const loopChanged = await setLoopEnabled(req.companyId, req.companyName, req.track, false)

      // #SEP-02 — best-effort release of the two provisioned resources with a
      // confirmed real release API (ZeroDB projects and purchased domains have
      // NO delete endpoint anywhere — see this task's own research; left
      // unreleased, not silently simulated). Never let a release failure block
      // the lifecycle flip below — a founder expects "delete" to make the
      // company disappear from their view even if a backend is down.
      let zerovoiceReleased: boolean | undefined
      let byoDomainReleased: boolean | undefined
      const entry = await resolveApp(req.slug).catch(() => null)
      if (entry?.zerovoiceNumberId && founderJwt) {
        const released = await releaseZeroVoiceNumber(founderJwt, entry.zerovoiceNumberId)
        zerovoiceReleased = released.ok
      }
      if (entry?.byoDomainId) {
        const released = await deleteCustomDomain(entry.byoDomainId)
        byoDomainReleased = released.ok
      }

      const lifecycleChanged = await setAppLifecycle(req.slug, 'deleted')
      return { ok: true, action: 'delete', loopChanged, lifecycleChanged, zerovoiceReleased, byoDomainReleased }
    }
    default:
      return { ok: false, action: req.action, detail: 'unhandled action' }
  }
}
```

- [ ] **Step 10: Run it to verify it passes**

Run: `npx vitest run __tests__/lib/danger-zone-resource-release.test.ts`
Expected: PASS, 4/4.

- [ ] **Step 11: Pass the founder's real JWT through the route**

Modify `app/api/build/danger/route.ts` — the `session` object already available at the top of `POST` carries `accessToken` (same pattern as `app/api/build/zerovoice/route.ts:93`, already established in this codebase):

```typescript
const outcome = await applyDangerAction(parsed.value, (session as any)?.accessToken)
```

(Replace the existing `applyDangerAction(parsed.value)` call — this is the only change to this file.)

- [ ] **Step 12: Run the full suite**

Run: `npx vitest run`
Expected: all pass except the known `task-splitter.test.ts` flake (if it occurs, rerun it alone per the Global Constraints note and confirm it passes isolated).

- [ ] **Step 13: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 14: Commit**

```bash
git add lib/build/zerovoice.ts lib/build/railway-deploy.ts lib/build/danger-zone.ts app/api/build/danger/route.ts \
  __tests__/lib/build/zerovoice-release-number.test.ts __tests__/lib/build/railway-delete-custom-domain.test.ts \
  __tests__/lib/danger-zone-resource-release.test.ts
git commit -m "feat(danger-zone): release ZeroVoice number and BYO domain on delete (#<issue-number>)"
```

- [ ] **Step 15: Push and open the PR**

```bash
git push -u origin <branch-name>
gh pr create --repo AINative-Studio/builder-ainative-studio \
  --title "feat(danger-zone): release ZeroVoice number and BYO domain wiring on company delete" \
  --body "Closes #<issue-number>. Extends the Danger Zone delete flow to actually release the two provisioned resources with a confirmed real release API (ZeroVoice number, BYO domain Railway wiring). ZeroDB Instant DB projects and purchased domains have NO delete endpoint anywhere in their real, live APIs (verified directly against both services' OpenAPI/GraphQL schemas before writing this PR) -- left explicitly unreleased, not silently simulated. See the linked spec's SEP-02 section for the full research." \
  --base main
```

- [ ] **Step 16: Wait for CI, merge once green**

```bash
gh pr checks <pr-number> --repo AINative-Studio/builder-ainative-studio
gh pr merge <pr-number> --repo AINative-Studio/builder-ainative-studio --squash --delete-branch
```

- [ ] **Step 17: Confirm the Railway deploy, then live-verify like a human**

```bash
git log origin/main --oneline -3
# poll until the version matches:
curl -s https://builder.ainative.studio/api/health
```

Using Chrome MCP tools: sign in as a real account that has at least one company with NO ZeroVoice number or BYO domain provisioned (the common case). Open its Danger Zone, type the company name to confirm, click Delete. Confirm the company disappears from "My companies" and the request completes without error (open DevTools network tab or use `read_network_requests` to confirm the `/api/build/danger` call returns `{ok: true, ...}` with `zerovoiceReleased`/`byoDomainReleased` both `undefined` since neither resource existed on this company). This is the common-path regression check the Review Focus section calls out — most companies have neither resource, and this must still delete cleanly.

---

### Task 2: Email-code verification fallback

**Files:**
- Modify: `lib/build/otp.ts` (add `sendOtpEmail`)
- Modify: `app/api/build/register/route.ts` (add `action: 'send-otp-email'`)
- Modify: `components/build/screens/Auth.tsx` (add an email-fallback option alongside the existing Resend/Skip buttons from #950/#951)
- Test: `__tests__/lib/build/otp-email-fallback.test.ts`
- Test: `__tests__/api/build-register-otp-email.test.ts`
- Test: `__tests__/components/build/Auth-otp-email-fallback.test.tsx`

**Interfaces:**
- Consumes: `sendViaResend(from, to, subject, html, text): Promise<ResendSendResult>` (`lib/build/resend-client.ts`, already exists, already generic — confirmed via research, reused as-is, no changes to that file in this task). `insertOtpRow`, `OTP_TTL_MS`, `OTP_LENGTH` (internal to `lib/build/otp.ts`, already used by the existing phone-OTP `sendOtp` — the email path reuses the exact same code-generation and ZeroDB-storage logic, never a parallel store).
- Produces: `sendOtpEmail(email: string): Promise<SendOtpResult>` (same `SendOtpResult` interface phone-OTP's `sendOtp` already returns — `{ok, reason?, expiresAt?}`), a new `action: 'send-otp-email'` branch on `POST /api/build/register`, and a new "Email me a code instead" option in `Auth.tsx`'s existing OTP-fallback UI from #950/#951 (`auth-otp-fallback` test id).

- [ ] **Step 1: File the GitHub issue**

```bash
gh issue create --repo AINative-Studio/builder-ainative-studio \
  --title "feat(auth): email-code verification fallback alongside phone OTP" \
  --body "Part of Epic 1 (BLD-02b). The phone-OTP flow (#734) has a 'Skip for now' escape hatch shipped as #950/#951 when a code never arrives, but no actual alternative verification channel. This adds a real email-code send/verify path, reusing the exact same builder_otp_codes storage and verifyOtp() function phone-OTP already uses -- never a parallel, divergent verification system." \
  --label "enhancement"
```

- [ ] **Step 2: Write the failing test for `sendOtpEmail`**

```typescript
// __tests__/lib/build/otp-email-fallback.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ sendViaResend: vi.fn() }))
vi.mock('@/lib/build/resend-client', () => ({ sendViaResend: h.sendViaResend, resendConfigured: () => true }))

describe('sendOtpEmail', () => {
  beforeEach(() => { h.sendViaResend.mockReset().mockResolvedValue({ ok: true }) })

  it('sends a real email via the existing Resend client with a 6-digit code in the body', async () => {
    const { sendOtpEmail } = await import('@/lib/build/otp')
    const result = await sendOtpEmail('founder@example.com')
    expect(result.ok).toBe(true)
    expect(h.sendViaResend).toHaveBeenCalledTimes(1)
    const [, to, subject, html, text] = h.sendViaResend.mock.calls[0]
    expect(to).toBe('founder@example.com')
    expect(subject.toLowerCase()).toContain('verification code')
    expect(html + text).toMatch(/\b\d{6}\b/)
  })

  it('stores the code so it verifies through the SAME verifyOtp() phone-OTP uses', async () => {
    const { sendOtpEmail, verifyOtp } = await import('@/lib/build/otp')
    await sendOtpEmail('founder@example.com')
    const sentCode = h.sendViaResend.mock.calls[0][3].match(/\b(\d{6})\b/)[1]
    const result = await verifyOtp('founder@example.com', sentCode)
    expect(result.ok).toBe(true)
  })

  it('returns ok:false with reason "invalid_email" for a malformed address, without calling Resend', async () => {
    const { sendOtpEmail } = await import('@/lib/build/otp')
    const result = await sendOtpEmail('not-an-email')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('invalid_email')
    expect(h.sendViaResend).not.toHaveBeenCalled()
  })

  it('returns ok:false with reason "send_failed" when Resend itself fails, never throws', async () => {
    h.sendViaResend.mockResolvedValue({ ok: false, reason: 'resend_5xx' })
    const { sendOtpEmail } = await import('@/lib/build/otp')
    const result = await sendOtpEmail('founder@example.com')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('send_failed')
  })
})
```

Note: `verifyOtp` currently keys stored rows by phone (its own `phone` field in `OtpRow`). Reusing it for email means the row's `phone` field holds the email address instead — same lookup-by-identifier mechanism, no schema change needed (confirmed: `insertOtpRow`/`rowsForPhone` operate on a plain string identifier, never validate it's a phone number specifically).

- [ ] **Step 2b: Run it to verify it fails**

Run: `npx vitest run __tests__/lib/build/otp-email-fallback.test.ts`
Expected: FAIL — `sendOtpEmail is not a function`.

- [ ] **Step 3: Implement `sendOtpEmail`**

Add to `lib/build/otp.ts`, below the existing `sendOtp` function:

```typescript
import { sendViaResend, resendConfigured } from '@/lib/build/resend-client'

/**
 * Email-code fallback (#BLD-02b) alongside phone-OTP's sendOtp above. Reuses
 * the EXACT SAME code-generation, ZeroDB storage (insertOtpRow), and
 * verification (verifyOtp) as phone-OTP -- the only difference is the
 * identifier is an email address and the delivery channel is Resend instead
 * of Twilio. Never a parallel, divergent verification system.
 */
export async function sendOtpEmail(email: string): Promise<SendOtpResult> {
  const trimmed = (email || '').trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) return { ok: false, reason: 'invalid_email' }
  if (!configured()) return { ok: false, reason: 'registry_unavailable' }
  if (!resendConfigured()) return { ok: false, reason: 'not_configured' }

  const code = String(Math.floor(Math.random() * 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + OTP_TTL_MS).toISOString()

  const stored = await insertOtpRow({ phone: trimmed, code, expiresAt, createdAt: now.toISOString() })
  if (!stored) return { ok: false, reason: 'storage_failed' }

  const sendResult = await sendViaResend(
    'AINative Builder <noreply@ainative.studio>',
    trimmed,
    'Your AINative Builder verification code',
    `<p>Your verification code is <strong>${code}</strong>. It expires in 10 minutes.</p>`,
    `Your verification code is ${code}. It expires in 10 minutes.`,
  )
  if (!sendResult.ok) return { ok: false, reason: 'send_failed', expiresAt }
  return { ok: true, expiresAt }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run __tests__/lib/build/otp-email-fallback.test.ts`
Expected: PASS, 4/4.

- [ ] **Step 5: Write the failing test for the register route's new action**

```typescript
// __tests__/api/build-register-otp-email.test.ts
/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ sendOtpEmail: vi.fn() }))
vi.mock('@/lib/build/otp', async () => {
  const actual = await vi.importActual<typeof import('@/lib/build/otp')>('@/lib/build/otp')
  return { ...actual, sendOtpEmail: h.sendOtpEmail }
})

import { POST } from '@/app/api/build/register/route'

function req(body: unknown) {
  return { json: async () => body, headers: { get: () => null } } as any
}

describe("POST /api/build/register — action:'send-otp-email' (#BLD-02b)", () => {
  beforeEach(() => { h.sendOtpEmail.mockReset() })

  it('calls sendOtpEmail with the submitted email and returns its result', async () => {
    h.sendOtpEmail.mockResolvedValue({ ok: true, expiresAt: '2026-10-06T00:10:00.000Z' })
    const res = await POST(req({ action: 'send-otp-email', email: 'founder@example.com' }))
    expect(res.status).toBe(200)
    expect(h.sendOtpEmail).toHaveBeenCalledWith('founder@example.com')
    expect((await res.json()).ok).toBe(true)
  })

  it('rejects a missing email before calling sendOtpEmail', async () => {
    const res = await POST(req({ action: 'send-otp-email', email: '' }))
    expect(res.status).toBe(400)
    expect(h.sendOtpEmail).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 5b: Run it to verify it fails**

Run: `npx vitest run __tests__/api/build-register-otp-email.test.ts`
Expected: FAIL — no `'send-otp-email'` branch exists in the route yet.

- [ ] **Step 6: Add the route branch**

In `app/api/build/register/route.ts`, add a handler mirroring the existing `handleSendOtp` function exactly, and wire it into the existing action-dispatch `if` chain (next to the existing `if (b?.action === 'send-otp') ...` line):

```typescript
async function handleSendOtpEmail(email: string) {
  const trimmed = (email || '').trim()
  if (!trimmed) return Response.json({ ok: false, reason: 'invalid_email' }, { status: 400 })
  const result = await sendOtpEmail(trimmed)
  const status = result.ok ? 200 : (result.reason === 'not_configured' ? 200 : 502)
  return Response.json(result, { status })
}
```

```typescript
if (b?.action === 'send-otp-email') return handleSendOtpEmail(String(b?.email || ''))
```

Add `sendOtpEmail` to the existing `import { sendOtp, verifyOtp, toE164, checkOtpRateLimit } from '@/lib/build/otp'` line at the top of the file.

- [ ] **Step 7: Run it to verify it passes**

Run: `npx vitest run __tests__/api/build-register-otp-email.test.ts`
Expected: PASS, 2/2.

- [ ] **Step 8: Write the failing test for the Auth.tsx UI addition**

```typescript
// __tests__/components/build/Auth-otp-email-fallback.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

const signInMock = vi.fn(async (): Promise<{ error: string | null }> => ({ error: null }))
vi.mock('next-auth/react', () => ({ signIn: (_provider: string, _opts: any) => signInMock() }))
vi.mock('@/components/analytics/google-analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('@/components/analytics/meta-pixel', () => ({ trackMeta: vi.fn() }))
vi.mock('@/lib/build/guest-migration', () => ({ migrateGuestWork: vi.fn(async () => {}) }))
vi.mock('@/lib/build/attribution', () => ({ getRefCode: () => null }))
vi.mock('@/lib/build/value-moment', () => ({ decideLimitAction: () => 'continue' }))

const dispatchMock = vi.fn()
vi.mock('@/contexts/build-context', () => ({ useBuild: () => ({ state: {}, dispatch: dispatchMock }) }))

import { Auth } from '@/components/build/screens/Auth'

let host: HTMLElement
let root: Root
function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}
afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.clearAllMocks()
})

function setValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
async function tick(times = 4) {
  for (let i = 0; i < times; i++) await act(async () => { await Promise.resolve() })
}

describe('Auth signup — email-OTP fallback option (#BLD-02b)', () => {
  it('offers "Email me a code instead" in the fallback once it appears, and sending it calls send-otp-email', async () => {
    vi.useFakeTimers()
    global.fetch = vi.fn(async (url: string, opts?: any) => {
      const body = JSON.parse(opts.body)
      if (body.action === 'send-otp') return { ok: true, json: async () => ({ ok: true, expiresAt: 'x' }) }
      if (body.action === 'send-otp-email') {
        expect(body.email).toBe('a@b.com')
        return { ok: true, json: async () => ({ ok: true, expiresAt: 'x' }) }
      }
      return { ok: true, json: async () => ({}) }
    }) as any

    render(React.createElement(Auth, { mode: 'signup' }))
    const emailInput = host.querySelector('[data-testid="auth-email"]') as HTMLInputElement
    const phoneInput = host.querySelector('[data-testid="auth-phone"]') as HTMLInputElement
    await act(async () => {
      setValue(emailInput, 'a@b.com')
      setValue(phoneInput, '5550001111')
    })
    const sendBtn = host.querySelector('[data-testid="auth-send-otp"]') as HTMLButtonElement
    await act(async () => { sendBtn.click(); await tick() })
    await act(async () => { vi.advanceTimersByTime(45_000) })

    const emailFallbackBtn = host.querySelector('[data-testid="auth-otp-email-fallback"]') as HTMLButtonElement
    expect(emailFallbackBtn).toBeTruthy()
    await act(async () => { emailFallbackBtn.click(); await tick() })

    expect(host.querySelector('[data-testid="auth-otp-note"]')?.textContent).toContain('email')
    vi.useRealTimers()
  })
})
```

- [ ] **Step 8b: Run it to verify it fails**

Run: `npx vitest run __tests__/components/build/Auth-otp-email-fallback.test.tsx`
Expected: FAIL — no `auth-otp-email-fallback` element exists yet.

- [ ] **Step 9: Add the UI**

In `components/build/screens/Auth.tsx`, find the existing fallback block from #950/#951 (`data-testid="auth-otp-fallback"`, containing `auth-otp-resend` and `auth-otp-skip` buttons). Add a new handler and button alongside the existing two:

```typescript
const emailOtpFallback = async () => {
  setBusy(true); setError(null)
  try {
    const res = await fetch('/api/build/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'send-otp-email', email }),
    })
    const d = await res.json().catch(() => null)
    if (d?.ok) {
      setOtpNote('Code sent to your email — enter it below.')
      setOtpFallbackDue(false)
    } else {
      setError('Could not send the code by email — try again.')
    }
  } catch {
    setError('Network error — try again.')
  } finally {
    setBusy(false)
  }
}
```

Inside the existing `auth-otp-fallback` div, after the `auth-otp-skip` button:

```tsx
<button className="btn-ghost" data-testid="auth-otp-email-fallback" onClick={emailOtpFallback} disabled={busy} type="button">
  Email me a code instead
</button>
```

- [ ] **Step 10: Run it to verify it passes**

Run: `npx vitest run __tests__/components/build/Auth-otp-email-fallback.test.tsx`
Expected: PASS, 1/1.

- [ ] **Step 11: Run the existing OTP test suite to confirm no regression**

Run: `npx vitest run __tests__/components/build/Auth-phone-otp.test.tsx __tests__/components/build/Auth-phone-otp-resend-skip.test.tsx`
Expected: all pass unchanged (13/13 — the pre-existing counts from #950/#951).

- [ ] **Step 12: Run the full suite**

Run: `npx vitest run`
Expected: all pass except the known `task-splitter.test.ts` flake (same handling as Task 1 Step 12).

- [ ] **Step 13: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 14: Commit**

```bash
git add lib/build/otp.ts app/api/build/register/route.ts components/build/screens/Auth.tsx \
  __tests__/lib/build/otp-email-fallback.test.ts __tests__/api/build-register-otp-email.test.ts \
  __tests__/components/build/Auth-otp-email-fallback.test.tsx
git commit -m "feat(auth): email-code verification fallback alongside phone OTP (#<issue-number>)"
```

- [ ] **Step 15: Push, PR, CI, merge**

```bash
git push -u origin <branch-name>
gh pr create --repo AINative-Studio/builder-ainative-studio \
  --title "feat(auth): email-code verification fallback alongside phone OTP" \
  --body "Closes #<issue-number>. Adds a real email-code send/verify path alongside phone-OTP, reusing the exact same builder_otp_codes storage and verifyOtp() -- never a parallel verification system. Surfaced in the existing #950/#951 OTP-fallback UI as a third option alongside Resend/Skip." \
  --base main
gh pr checks <pr-number> --repo AINative-Studio/builder-ainative-studio
gh pr merge <pr-number> --repo AINative-Studio/builder-ainative-studio --squash --delete-branch
```

- [ ] **Step 16: Confirm deploy, then live-verify like a human**

```bash
curl -s https://builder.ainative.studio/api/health
```

Using Chrome MCP tools: real signed-out signup, enter a real phone number you control (or the session's established real test number), send the code, wait the 45s for the fallback, click "Email me a code instead," confirm a real code arrives in a real inbox you control and verifies successfully. If no real email inbox is readily testable in this session, at minimum confirm via `read_network_requests` that the real `send-otp-email` POST fires and returns `{ok: true}`, and document in the task-done note that full email-receipt verification needs a real inbox check.

---

### Task 3: Twilio delivery-status webhook for faster OTP failure detection

**Files:**
- Create: `app/api/webhooks/twilio/otp-status/route.ts`
- Modify: `lib/build/otp.ts` (`sendSharedSms` gains a `StatusCallback` param; add `recordOtpDeliveryStatus`/`getOtpDeliveryStatus`)
- Modify: `components/build/screens/Auth.tsx` (poll the new status instead of waiting out the blind 45s timeout when a confirmed failure lands sooner)
- Test: `__tests__/api/webhooks-twilio-otp-status.test.ts`
- Test: `__tests__/lib/build/otp-delivery-status.test.ts`

**Interfaces:**
- Consumes: `sendSharedSms(toE164Number: string, body: string): Promise<SharedSmsResult>` (existing, `lib/build/otp.ts`) — extended with an optional `statusCallbackUrl` so the SAME function phone-OTP already calls also starts getting real delivery status.
- Produces: `recordOtpDeliveryStatus(messageSid: string, status: 'delivered' | 'undelivered' | 'failed'): Promise<void>`, `getOtpDeliveryStatus(phone: string): Promise<'pending' | 'delivered' | 'undelivered' | 'failed'>`, consumed by `Auth.tsx`'s existing OTP-fallback polling.

**Review Focus item this task owns:** a status callback for a DIFFERENT Twilio send (e.g. the shared Text-Cody number's real SMS traffic from #936/#947, sent from the same Twilio account) must never be mistaken for an OTP delivery-failure signal.

- [ ] **Step 1: File the GitHub issue**

```bash
gh issue create --repo AINative-Studio/builder-ainative-studio \
  --title "feat(auth): wire Twilio delivery-status webhook for faster OTP failure detection" \
  --body "Part of Epic 1 (BLD-02c refinement). The existing #950/#951 fallback is a blind 45s client timeout. This wires Twilio's real StatusCallback so a CONFIRMED undelivered/failed status surfaces the Resend/Skip fallback immediately, without waiting out the full timeout. Confirmed via direct code read: lib/build/otp.ts's sendSharedSms currently passes no StatusCallback param at all -- this is new wiring, not an extension of an existing webhook (no Twilio status webhook route exists anywhere in this codebase today)." \
  --label "enhancement"
```

- [ ] **Step 2: Write the failing test for the webhook route**

```typescript
// __tests__/api/webhooks-twilio-otp-status.test.ts
/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ recordOtpDeliveryStatus: vi.fn() }))
vi.mock('@/lib/build/otp', () => ({ recordOtpDeliveryStatus: h.recordOtpDeliveryStatus }))

import { POST } from '@/app/api/webhooks/twilio/otp-status/route'

function formReq(fields: Record<string, string>) {
  const body = new URLSearchParams(fields)
  return {
    text: async () => body.toString(),
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'application/x-www-form-urlencoded' : null) },
  } as any
}

describe('POST /api/webhooks/twilio/otp-status (#BLD-02c)', () => {
  beforeEach(() => { h.recordOtpDeliveryStatus.mockReset().mockResolvedValue(undefined) })

  it('records an undelivered status against the real MessageSid', async () => {
    const res = await POST(formReq({ MessageSid: 'SMabc123', MessageStatus: 'undelivered', ErrorCode: '30034' }))
    expect(res.status).toBe(200)
    expect(h.recordOtpDeliveryStatus).toHaveBeenCalledWith('SMabc123', 'undelivered')
  })

  it('records a delivered status the same way', async () => {
    const res = await POST(formReq({ MessageSid: 'SMdef456', MessageStatus: 'delivered' }))
    expect(res.status).toBe(200)
    expect(h.recordOtpDeliveryStatus).toHaveBeenCalledWith('SMdef456', 'delivered')
  })

  it('ignores an intermediate status (queued, sent) — only terminal statuses are recorded', async () => {
    const res = await POST(formReq({ MessageSid: 'SMghi789', MessageStatus: 'sent' }))
    expect(res.status).toBe(200)
    expect(h.recordOtpDeliveryStatus).not.toHaveBeenCalled()
  })

  it('returns 200 even on a malformed body, never throws (Twilio retries on non-2xx)', async () => {
    const res = await POST({ text: async () => 'not-a-valid-body', headers: { get: () => null } } as any)
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2b: Run it to verify it fails**

Run: `npx vitest run __tests__/api/webhooks-twilio-otp-status.test.ts`
Expected: FAIL — the route file doesn't exist yet.

- [ ] **Step 3: Write the failing test for `recordOtpDeliveryStatus`/`getOtpDeliveryStatus`**

```typescript
// __tests__/lib/build/otp-delivery-status.test.ts
import { describe, it, expect, beforeEach } from 'vitest'

describe('OTP delivery status tracking (#BLD-02c)', () => {
  it('records and retrieves a delivery status by phone, keyed via the real messageSid-to-phone mapping stored at send time', async () => {
    const { recordOtpSendMapping, recordOtpDeliveryStatus, getOtpDeliveryStatus } = await import('@/lib/build/otp')
    await recordOtpSendMapping('SMabc123', '+15550001111')
    await recordOtpDeliveryStatus('SMabc123', 'undelivered')
    const status = await getOtpDeliveryStatus('+15550001111')
    expect(status).toBe('undelivered')
  })

  it('returns "pending" for a phone with no recorded status yet', async () => {
    const { getOtpDeliveryStatus } = await import('@/lib/build/otp')
    const status = await getOtpDeliveryStatus('+15559999999')
    expect(status).toBe('pending')
  })

  it('a status update for an UNMAPPED messageSid is silently dropped, never crashes, never associates with the wrong phone', async () => {
    const { recordOtpDeliveryStatus } = await import('@/lib/build/otp')
    await expect(recordOtpDeliveryStatus('SMunknown999', 'delivered')).resolves.not.toThrow()
  })
})
```

- [ ] **Step 3b: Run it to verify it fails**

Run: `npx vitest run __tests__/lib/build/otp-delivery-status.test.ts`
Expected: FAIL — `recordOtpSendMapping`/`recordOtpDeliveryStatus`/`getOtpDeliveryStatus` don't exist yet.

- [ ] **Step 4: Implement the mapping + status functions**

Add to `lib/build/otp.ts`, below `sendSharedSms`. Uses the SAME ZeroDB-table pattern as `OTP_TABLE`/`insertOtpRow` elsewhere in this file (a new, small table — `builder_otp_delivery` — mirrors the exact `ensureOtpTable`-then-write idempotent-create pattern already established for `builder_otp_codes` in this same file; do not invent a different persistence mechanism):

```typescript
const DELIVERY_TABLE = 'builder_otp_delivery'

interface OtpDeliveryRow {
  messageSid: string
  phone: string
  status?: 'delivered' | 'undelivered' | 'failed'
  createdAt: string
}

async function ensureDeliveryTable(): Promise<void> {
  try {
    await fetch(`${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ table_name: DELIVERY_TABLE }),
      signal: AbortSignal.timeout(5000),
    })
  } catch { /* table might already exist */ }
}

/** Record which phone a just-sent Twilio MessageSid belongs to, so a later status callback (keyed only by MessageSid) can be resolved back to the right phone (#BLD-02c). Called right after a successful sendSharedSms. */
export async function recordOtpSendMapping(messageSid: string, phone: string): Promise<void> {
  if (!configured() || !messageSid || !phone) return
  await ensureDeliveryTable()
  try {
    await fetch(`${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables/${DELIVERY_TABLE}/rows`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ row_data: { messageSid, phone, createdAt: new Date().toISOString() } }),
      signal: AbortSignal.timeout(10000),
    })
  } catch { /* best-effort — a missed mapping just means the webhook can't resolve this one send, the 45s client timeout still applies as the fallback */ }
}

/** Append a row to DELIVERY_TABLE. Mirrors insertOtpRow's exact shape (same ensureTable-then-write pattern already established for OTP_TABLE in this file) but targets DELIVERY_TABLE — insertOtpRow itself is hardcoded to OTP_TABLE and is never reused here. */
async function recordDeliveryRow(row: OtpDeliveryRow): Promise<boolean> {
  if (!configured()) return false
  await ensureDeliveryTable()
  try {
    const res = await fetch(`${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables/${DELIVERY_TABLE}/rows`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ row_data: row }),
      signal: AbortSignal.timeout(15000),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Record a real Twilio delivery-status callback against its MessageSid (#BLD-02c). A callback for a MessageSid this flow never sent (e.g. a different SMS flow's Twilio traffic) finds no matching row and is silently dropped — never guessed at or associated with the wrong phone. Appends an updated row (append-only/latest-wins, same pattern verifyOtp's own consumed-marking already uses in this file) rather than mutating the original mapping row. */
export async function recordOtpDeliveryStatus(messageSid: string, status: 'delivered' | 'undelivered' | 'failed'): Promise<void> {
  if (!configured() || !messageSid) return
  try {
    const res = await fetch(`${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables/${DELIVERY_TABLE}/rows?limit=1000`, { headers: headers(), signal: AbortSignal.timeout(15000) })
    if (!res.ok) return
    const data = JSON.parse(await res.text())
    const rows = Array.isArray(data) ? data : data.data || data.rows || []
    const match = rows.map((r: { row_data?: OtpDeliveryRow }) => r.row_data).find((rd: OtpDeliveryRow | undefined) => rd?.messageSid === messageSid)
    if (!match) return // unmapped sid — not this flow's send, drop silently
    await recordDeliveryRow({ ...match, status })
  } catch { /* best-effort */ }
}

/** Current delivery status for a phone's most recent OTP send (#BLD-02c). 'pending' when nothing has been recorded yet (no callback has landed, or none was ever sent). */
export async function getOtpDeliveryStatus(phone: string): Promise<'pending' | 'delivered' | 'undelivered' | 'failed'> {
  if (!configured() || !phone) return 'pending'
  try {
    const res = await fetch(`${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables/${DELIVERY_TABLE}/rows?limit=1000`, { headers: headers(), signal: AbortSignal.timeout(15000) })
    if (!res.ok) return 'pending'
    const data = JSON.parse(await res.text())
    const rows = Array.isArray(data) ? data : data.data || data.rows || []
    const matches = rows.map((r: { row_data?: OtpDeliveryRow }) => r.row_data).filter((rd: OtpDeliveryRow | undefined) => rd?.phone === phone)
    matches.sort((a: OtpDeliveryRow, b: OtpDeliveryRow) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    return matches[0]?.status || 'pending'
  } catch {
    return 'pending'
  }
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run __tests__/lib/build/otp-delivery-status.test.ts`
Expected: PASS, 3/3.

- [ ] **Step 6: Wire `recordOtpSendMapping` into `sendSharedSms`'s OTP call site**

In `lib/build/otp.ts`'s `sendOtp` function, after a successful `sendSharedSms` call, extract the real `MessageSid` Twilio returns and record the mapping. First, extend `sendSharedSms`'s return type (it currently discards Twilio's response body on success):

```typescript
export interface SharedSmsResult {
  ok: boolean
  reason?: string
  messageSid?: string
}
```

In `sendSharedSms`, on the success path, capture and return the sid:

```typescript
const data = await res.json().catch(() => null)
if (!res.ok) {
  return { ok: false, reason: String(data?.message || res.status).slice(0, 160) }
}
return { ok: true, messageSid: data?.sid }
```

Also add the real `StatusCallback` param to the outbound Twilio request so Twilio actually calls the new webhook:

```typescript
const params = new URLSearchParams({
  From: fromNumber, To: toE164Number, Body: body,
  StatusCallback: `${process.env.NEXT_PUBLIC_APP_URL || 'https://builder.ainative.studio'}/api/webhooks/twilio/otp-status`,
})
```

In `sendOtp`, after the existing `const sendResult = await sendSharedSms(...)` line:

```typescript
if (sendResult.ok && sendResult.messageSid) {
  recordOtpSendMapping(sendResult.messageSid, phone).catch(() => {})
}
```

- [ ] **Step 7: Implement the webhook route**

```typescript
// app/api/webhooks/twilio/otp-status/route.ts
import { NextRequest } from 'next/server'
import { recordOtpDeliveryStatus } from '@/lib/build/otp'

export const runtime = 'nodejs'

const TERMINAL_STATUSES = new Set(['delivered', 'undelivered', 'failed'])

/**
 * Twilio's real StatusCallback for OTP sends (#BLD-02c) — form-encoded POST,
 * MessageSid + MessageStatus are the fields this handler cares about. Only
 * terminal statuses are recorded (queued/sending/sent are mid-flight, not
 * actionable). Always returns 200 — a non-2xx makes Twilio retry the
 * callback, and a malformed/unexpected body here is never Twilio's fault to
 * retry into.
 */
export async function POST(request: NextRequest) {
  try {
    const raw = await request.text()
    const params = new URLSearchParams(raw)
    const messageSid = params.get('MessageSid')
    const status = params.get('MessageStatus')
    if (messageSid && status && TERMINAL_STATUSES.has(status)) {
      await recordOtpDeliveryStatus(messageSid, status as 'delivered' | 'undelivered' | 'failed')
    }
  } catch {
    // never fail this webhook — see doc comment above
  }
  return new Response(null, { status: 200 })
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `npx vitest run __tests__/api/webhooks-twilio-otp-status.test.ts`
Expected: PASS, 4/4.

- [ ] **Step 9: Wire faster detection into `Auth.tsx`'s existing fallback timer**

In `components/build/screens/Auth.tsx`, the existing `useEffect` from #950/#951 that arms a 45-second `setTimeout` to set `otpFallbackDue(true)` gets a parallel poll:

```typescript
useEffect(() => {
  if (!verifyPhone) return
  const timer = setTimeout(() => setOtpFallbackDue(true), 45_000)
  const normalizedPhone = toE164(phone)
  const poll = normalizedPhone ? setInterval(async () => {
    try {
      const res = await fetch(`/api/build/otp-delivery-status?phone=${encodeURIComponent(normalizedPhone)}`)
      const d = await res.json().catch(() => null)
      if (d?.status === 'undelivered' || d?.status === 'failed') {
        setOtpFallbackDue(true)
        clearTimeout(timer)
        clearInterval(poll)
      }
    } catch { /* keep polling — the 45s timer is still the backstop */ }
  }, 5000) : undefined
  return () => { clearTimeout(timer); if (poll) clearInterval(poll) }
}, [verifyPhone, phone])
```

This needs one new small route, `app/api/build/otp-delivery-status/route.ts`, exposing `getOtpDeliveryStatus` over GET:

```typescript
import { NextRequest } from 'next/server'
import { getOtpDeliveryStatus, toE164 } from '@/lib/build/otp'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const phone = toE164(request.nextUrl.searchParams.get('phone') || '')
  if (!phone) return Response.json({ status: 'pending' })
  const status = await getOtpDeliveryStatus(phone)
  return Response.json({ status })
}
```

No new test required for this thin route — it's a direct pass-through already covered by Step 5's `getOtpDeliveryStatus` unit tests; add one quick integration test only if the executor finds the pass-through has any real branching logic once written (it shouldn't).

- [ ] **Step 10: Run the existing OTP UI test suite to confirm no regression**

Run: `npx vitest run __tests__/components/build/Auth-phone-otp.test.tsx __tests__/components/build/Auth-phone-otp-resend-skip.test.tsx`
Expected: all pass unchanged — the new polling `useEffect` must not interfere with the existing 45s-timeout-driven tests (those tests use fake timers and never mock `fetch` for the new `otp-delivery-status` endpoint; confirm the poll's own fetch failures are silently swallowed, per Step 9's try/catch, so these pre-existing tests still pass without needing to mock the new endpoint at all).

- [ ] **Step 11: Run the full suite**

Run: `npx vitest run`
Expected: all pass except the known flake.

- [ ] **Step 12: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 13: Commit, push, PR, merge** (same shape as Tasks 1–2's final steps; reference this task's own issue number)

- [ ] **Step 14: Confirm deploy, then live-verify like a human**

Real signed-out signup with a real phone number you control. Send the code. If delivery genuinely fails (e.g. the still-open A2P campaign issue from this session means it likely will), confirm the fallback now appears BEFORE the full 45 seconds elapse — time it. If delivery succeeds, confirm the polling doesn't falsely trigger the fallback while a real code is in flight (verify via a real code entry that the OTP still verifies normally with no fallback ever shown).

---

### Task 4: Slack alert on SMS delivery failure

**Files:**
- Modify: `lib/jobs/alerting.ts` (add an SMS-delivery-failure alert rule)
- Modify: `lib/build/otp.ts` (`recordOtpDeliveryStatus` triggers the alert check on an `undelivered`/`failed` status)
- Test: `__tests__/lib/jobs/alerting-sms-delivery.test.ts`

**Interfaces:**
- Consumes: `sendSlackAlert(notification: AlertNotification): Promise<void>`, `shouldSendAlert(key: string): boolean` (both already exist in `lib/jobs/alerting.ts`, already wired into the real cron route `app/api/cron/alerts/route.ts` for 4 other alert types — reused as-is).
- Produces: `checkSmsDeliveryFailureAlert(errorCode?: string): Promise<void>`, called from `recordOtpDeliveryStatus` (Task 3) whenever a status is `undelivered` or `failed`.

- [ ] **Step 1: File the GitHub issue**

```bash
gh issue create --repo AINative-Studio/builder-ainative-studio \
  --title "feat(alerting): Slack alert when OTP SMS delivery fails" \
  --body "Part of Epic 1 (BLD-02d). lib/jobs/alerting.ts already has a real, wired Slack alerting mechanism (sendSlackAlert + shouldSendAlert's 5-min cooldown) used by 4 existing alert rules via app/api/cron/alerts/route.ts. This adds a 5th rule: alert when Task 3's new Twilio delivery-status webhook confirms an undelivered/failed OTP send, respecting the same cooldown so a carrier-wide outage (like the real, ongoing A2P 10DLC block this session already found) doesn't spam the channel once per failed send." \
  --label "enhancement"
```

- [ ] **Step 2: Write the failing test**

```typescript
// __tests__/lib/jobs/alerting-sms-delivery.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ sendSlackAlert: vi.fn(), shouldSendAlert: vi.fn() }))
vi.mock('@/lib/jobs/alerting', async () => {
  const actual = await vi.importActual<typeof import('@/lib/jobs/alerting')>('@/lib/jobs/alerting')
  return { ...actual, sendSlackAlert: h.sendSlackAlert, shouldSendAlert: h.shouldSendAlert }
})

import { checkSmsDeliveryFailureAlert } from '@/lib/jobs/alerting'

describe('checkSmsDeliveryFailureAlert (#BLD-02d)', () => {
  beforeEach(() => {
    h.sendSlackAlert.mockReset().mockResolvedValue(undefined)
    h.shouldSendAlert.mockReset().mockReturnValue(true)
  })

  it('sends a critical Slack alert with the real error code when the cooldown allows it', async () => {
    await checkSmsDeliveryFailureAlert('30034')
    expect(h.shouldSendAlert).toHaveBeenCalledWith('sms-delivery-failure')
    expect(h.sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({
      severity: 'critical',
      message: expect.stringContaining('30034'),
    }))
  })

  it('does not alert again within the cooldown window', async () => {
    h.shouldSendAlert.mockReturnValue(false)
    await checkSmsDeliveryFailureAlert('30034')
    expect(h.sendSlackAlert).not.toHaveBeenCalled()
  })

  it('still alerts (with a generic message) when no error code is given', async () => {
    await checkSmsDeliveryFailureAlert(undefined)
    expect(h.sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ severity: 'critical' }))
  })
})
```

- [ ] **Step 2b: Run it to verify it fails**

Run: `npx vitest run __tests__/lib/jobs/alerting-sms-delivery.test.ts`
Expected: FAIL — `checkSmsDeliveryFailureAlert` doesn't exist yet.

- [ ] **Step 3: Implement it**

Add to `lib/jobs/alerting.ts`, following the exact same shape as this file's 4 existing alert-check functions (read one of them first to match the real signature/style — do not guess the shape, mirror whichever existing check function is simplest, e.g. the Redis-failure one):

```typescript
/**
 * Alert on a confirmed OTP SMS delivery failure (#BLD-02d). Called from
 * otp.ts's recordOtpDeliveryStatus whenever Twilio's real webhook (#BLD-02c)
 * reports undelivered/failed. Respects the same 5-minute cooldown as every
 * other alert here — a carrier-wide block (confirmed real and ongoing this
 * session: the A2P 10DLC campaign stuck since 2026-09-21) must alert ONCE,
 * not once per failed send.
 */
export async function checkSmsDeliveryFailureAlert(errorCode?: string): Promise<void> {
  if (!shouldSendAlert('sms-delivery-failure')) return
  await sendSlackAlert({
    title: 'OTP SMS delivery failed',
    message: errorCode
      ? `A phone verification code failed to deliver (Twilio error ${errorCode}).`
      : 'A phone verification code failed to deliver.',
    severity: 'critical',
    timestamp: new Date().toISOString(),
  })
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run __tests__/lib/jobs/alerting-sms-delivery.test.ts`
Expected: PASS, 3/3.

- [ ] **Step 5: Wire it into `recordOtpDeliveryStatus`**

In `lib/build/otp.ts`'s `recordOtpDeliveryStatus` (Task 3), after successfully recording an `undelivered`/`failed` status:

```typescript
import { checkSmsDeliveryFailureAlert } from '@/lib/jobs/alerting'
```

```typescript
if (status === 'undelivered' || status === 'failed') {
  checkSmsDeliveryFailureAlert().catch(() => {})
}
```

(Placed after the real row-write succeeds, inside the existing `recordOtpDeliveryStatus` function from Task 3 Step 4 — fire-and-forget, never blocks the webhook's own response.)

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: all pass except the known flake.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 8: Commit, push, PR, merge** (same shape as prior tasks; reference this task's own issue number)

- [ ] **Step 9: Verify like a human (as close as this one gets)**

This alert is infrastructure, not user-facing UI — "verify like a human" here means: confirm a real `SLACK_WEBHOOK_URL` is actually configured in the Railway production environment (`railway variables --service builder-ainative-studio | grep SLACK_WEBHOOK_URL`); if it is, trigger a real end-to-end check by causing one real OTP send that's known to fail delivery (the existing, still-open A2P campaign issue means a real phone number's OTP send will likely genuinely come back `undelivered` from Twilio) and confirm a real message lands in the real Slack channel. If `SLACK_WEBHOOK_URL` is NOT configured in production, document that in the task-done note as a real, separate gap (the alerting code is correct and tested, but has no real destination configured) rather than claiming full verification.

---

## Completion

After Task 4, re-run `npx vitest run` and `npx tsc --noEmit` one final time across the whole branch (all four tasks' changes together, not just the last task's diff) to confirm nothing between tasks interacted badly. Then proceed per `superpowers:executing-plans`' own Final Review step.
