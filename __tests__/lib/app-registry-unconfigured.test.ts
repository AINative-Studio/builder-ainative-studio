import { describe, it, expect, beforeEach, vi } from 'vitest'

// app-registry.ts captures API_KEY + PROJECT_ID at MODULE LOAD (const) — this
// file deliberately does NOT set them, to exercise the real !configured()
// branch of resolveAppVerified() against a genuinely unconfigured
// environment (the exact real bug found live, 2026-09-30: a local dev
// environment missing ZERODB_PROJECT_ID).
vi.hoisted(() => {
  delete process.env.AINATIVE_API_KEY
  delete process.env.ZERODB_API_KEY
  delete process.env.API_Key
  delete process.env.ZERODB_PROJECT_ID
})

import { resolveAppVerified } from '@/lib/build/app-registry'

/**
 * Real bug found live (2026-09-30): `resolveAppVerified` used to return
 * `verified: true` — "confirmed, this company doesn't exist" — for the
 * `!configured()` case, exactly the same anti-pattern #807/#832 fixed for a
 * genuine network failure. A caller (contexts/build-context.tsx's deep-link
 * redirect) cannot tell "we never actually checked" from "we checked and it
 * really doesn't exist" when both come back as the identical
 * `{ entry: null, verified: true }` — and the former bounces a founder off
 * their own real, existing company on nothing more than a missing env var.
 */
describe('resolveAppVerified — unconfigured environment (2026-09-30)', () => {
  it('returns verified:false (an honest "could not check"), never verified:true, when unconfigured', async () => {
    const result = await resolveAppVerified('any-real-company')
    expect(result).toEqual({ entry: null, verified: false })
  })

  it('an empty slug is still a genuine, confirmed no-op (verified:true) — distinct from the unconfigured case', async () => {
    const result = await resolveAppVerified('')
    expect(result).toEqual({ entry: null, verified: true })
  })
})
