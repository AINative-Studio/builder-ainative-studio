import { describe, it, expect } from 'vitest'
import {
  resolveDefaultOrganizationId,
  type OAuthUserInfo,
} from '@/lib/auth/ainative-oauth'

/**
 * builder#796 — the OAuth callback used to trust core's single scalar
 * `organization_id` blindly as `workspaceId`, with no awareness of which
 * company/org the account was actually working in. core#7666 additively
 * ships a full, deterministically-ordered `organizations` list on
 * /oauth/userinfo (entries of {id, name, role, is_default}, ordered
 * is_default DESC, created_at ASC) specifically so callers like this one can
 * resolve a real default instead of the differently-ordered scalar.
 *
 * These tests pin `resolveDefaultOrganizationId`'s contract: prefer
 * `organizations[0]` whenever the array is present (even empty), and fall
 * back to the legacy scalar only when `organizations` is entirely absent
 * (an older core deployment that hasn't shipped #7666 yet).
 */
describe('resolveDefaultOrganizationId (builder#796)', () => {
  const base: OAuthUserInfo = { sub: 'user-1' }

  it('prefers organizations[0] over the scalar when both are present and differ', () => {
    // This is the exact failure mode from the issue: on /oauth/userinfo,
    // organizations[0] is NOT guaranteed to equal organization_id (different
    // resolvers/orderings, core refs #5730/#5233). The array must win.
    const info: OAuthUserInfo = {
      ...base,
      organization_id: 'org-scalar-stale',
      organizations: [
        { id: 'org-real-default', name: 'AINative Studio', role: 'OWNER', is_default: true },
        { id: 'org-secondary', name: 'Insta-Databases', role: 'ADMIN', is_default: false },
      ],
    }
    expect(resolveDefaultOrganizationId(info)).toBe('org-real-default')
  })

  it('uses organizations[0] as the ordered default for a multi-org account', () => {
    const info: OAuthUserInfo = {
      ...base,
      organization_id: 'org-b',
      organizations: [
        { id: 'org-a', name: 'AINative Studio', role: 'OWNER', is_default: true },
        { id: 'org-b', name: 'Insta-Databases', role: 'ADMIN', is_default: false },
        { id: 'org-c', name: 'Salt and Ledger', role: 'MEMBER', is_default: false },
      ],
    }
    // org-a is first because it's_default true and the list is pre-ordered by
    // core (is_default DESC, created_at ASC) — the client must not re-sort.
    expect(resolveDefaultOrganizationId(info)).toBe('org-a')
  })

  it('single-org account: organizations[0] is that one org', () => {
    const info: OAuthUserInfo = {
      ...base,
      organization_id: 'org-solo',
      organizations: [
        { id: 'org-solo', name: 'Solo Org', role: 'OWNER', is_default: false },
      ],
    }
    expect(resolveDefaultOrganizationId(info)).toBe('org-solo')
  })

  it('falls back to the legacy scalar when organizations is entirely absent (older core)', () => {
    const info: OAuthUserInfo = { ...base, organization_id: 'org-legacy' }
    expect(resolveDefaultOrganizationId(info)).toBe('org-legacy')
  })

  it('returns empty string when organizations is an empty array, even if the scalar is set', () => {
    // An empty array is a legitimate "no org memberships" signal from core —
    // it must not silently fall back to the (potentially wrong/stale) scalar.
    const info: OAuthUserInfo = {
      ...base,
      organization_id: 'org-should-not-be-used',
      organizations: [],
    }
    expect(resolveDefaultOrganizationId(info)).toBe('')
  })

  it('returns empty string when neither organizations nor organization_id is present', () => {
    expect(resolveDefaultOrganizationId({ ...base })).toBe('')
  })

  it('handles an organizations[0] entry with a missing id gracefully', () => {
    const info: OAuthUserInfo = {
      ...base,
      organization_id: 'org-legacy',
      organizations: [{ id: '' as unknown as string, name: 'Broken Entry' }],
    }
    expect(resolveDefaultOrganizationId(info)).toBe('')
  })
})
