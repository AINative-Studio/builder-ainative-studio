/**
 * Unit tests for lib/build/live-vs-planned.ts (#67)
 *
 * Covers all branches of the live-vs-planned state logic:
 *   - deriveSystemStatus
 *   - systemBadge
 *   - planFramingLine
 *   - countSystemStatuses
 *   - STATUS_BADGE config shape
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest'
import {
  deriveSystemStatus,
  systemBadge,
  planFramingLine,
  countSystemStatuses,
  STATUS_BADGE,
  type SystemStatus,
} from '@/lib/build/live-vs-planned'

// ---------------------------------------------------------------------------
// STATUS_BADGE config
// ---------------------------------------------------------------------------

describe('STATUS_BADGE', () => {
  it('live badge uses is-done modifier', () => {
    expect(STATUS_BADGE.live.modifier).toBe('is-done')
  })

  it('live badge has "Live" label', () => {
    expect(STATUS_BADGE.live.label).toBe('Live')
  })

  it('planned badge uses is-running modifier', () => {
    expect(STATUS_BADGE.planned.modifier).toBe('is-running')
  })

  it('planned badge has "Planned" label', () => {
    expect(STATUS_BADGE.planned.label).toBe('Planned')
  })

  it('both badges have non-empty descriptions', () => {
    expect(STATUS_BADGE.live.description.length).toBeGreaterThan(0)
    expect(STATUS_BADGE.planned.description.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// deriveSystemStatus
// ---------------------------------------------------------------------------

describe('deriveSystemStatus', () => {
  it('returns "live" when url is set', () => {
    expect(deriveSystemStatus({ url: 'https://acme.ainative.studio' })).toBe('live')
  })

  it('returns "live" when provisioned is true', () => {
    expect(deriveSystemStatus({ provisioned: true })).toBe('live')
  })

  it('returns "live" when both url and provisioned are set', () => {
    expect(deriveSystemStatus({ url: 'https://acme.ainative.studio', provisioned: true })).toBe('live')
  })

  it('returns "planned" when neither url nor provisioned is set', () => {
    expect(deriveSystemStatus({})).toBe('planned')
  })

  it('returns "planned" when provisioned is false and no url', () => {
    expect(deriveSystemStatus({ provisioned: false })).toBe('planned')
  })

  it('returns "planned" when provisioned is undefined and no url', () => {
    expect(deriveSystemStatus({ provisioned: undefined })).toBe('planned')
  })

  it('url takes precedence even when provisioned is falsy', () => {
    expect(deriveSystemStatus({ url: 'https://example.com', provisioned: false })).toBe('live')
  })

  it('empty string url does not count as live', () => {
    // An empty url is falsy in JS — treated as no url
    expect(deriveSystemStatus({ url: '', provisioned: false })).toBe('planned')
  })
})

// ---------------------------------------------------------------------------
// systemBadge
// ---------------------------------------------------------------------------

describe('systemBadge', () => {
  it('returns live badge config when url is provided', () => {
    const badge = systemBadge({ url: 'https://acme.ainative.studio' })
    expect(badge.status).toBe('live')
    expect(badge.modifier).toBe('is-done')
    expect(badge.label).toBe('Live')
  })

  it('returns live badge config when provisioned is true', () => {
    const badge = systemBadge({ provisioned: true })
    expect(badge.status).toBe('live')
    expect(badge.modifier).toBe('is-done')
  })

  it('returns planned badge config for unprovisioned system', () => {
    const badge = systemBadge({})
    expect(badge.status).toBe('planned')
    expect(badge.modifier).toBe('is-running')
    expect(badge.label).toBe('Planned')
  })

  it('returns the full StatusBadgeConfig shape (status, modifier, label, description)', () => {
    const badge = systemBadge({ provisioned: true })
    expect(badge).toHaveProperty('status')
    expect(badge).toHaveProperty('modifier')
    expect(badge).toHaveProperty('label')
    expect(badge).toHaveProperty('description')
  })
})

// ---------------------------------------------------------------------------
// planFramingLine
// ---------------------------------------------------------------------------

describe('planFramingLine', () => {
  it('handles zero total systems', () => {
    const line = planFramingLine(0, 0)
    expect(line).toContain("Cody's plan")
    expect(line).toContain('go live')
  })

  it('all planned (none live) — singular system', () => {
    const line = planFramingLine(0, 1)
    expect(line).toContain('1 system')
    expect(line).toContain('go live')
    // Should say "gets" for singular
    expect(line).toContain('gets')
  })

  it('all planned (none live) — plural systems', () => {
    const line = planFramingLine(0, 4)
    expect(line).toContain('4 systems')
    expect(line).toContain('get')
    expect(line).toContain('go live')
  })

  it('all systems live — singular', () => {
    const line = planFramingLine(1, 1)
    expect(line).toContain('1 system')
    expect(line).toContain('live')
    expect(line).toContain('running')
  })

  it('all systems live — plural', () => {
    const line = planFramingLine(4, 4)
    expect(line).toContain('4 systems')
    expect(line).toContain('live')
    expect(line).toContain('running')
  })

  it('mixed: some live, some planned', () => {
    const line = planFramingLine(1, 4)
    expect(line).toContain('1 live')
    expect(line).toContain('3 more')
    expect(line).toContain('go live')
  })

  it('mixed: most live, one planned', () => {
    const line = planFramingLine(3, 4)
    expect(line).toContain('3 live')
    expect(line).toContain('1 more')
    // Singular "gets"
    expect(line).toContain('gets')
  })

  it('never implies all planned are already built', () => {
    const line = planFramingLine(0, 4)
    // Must NOT say "live" in a way that implies all are live
    expect(line).not.toMatch(/all.*live/i)
  })
})

// ---------------------------------------------------------------------------
// countSystemStatuses
// ---------------------------------------------------------------------------

describe('countSystemStatuses', () => {
  it('returns zeros for an empty list', () => {
    const result = countSystemStatuses([])
    expect(result).toEqual({ live: 0, planned: 0, total: 0 })
  })

  it('correctly counts all-planned systems', () => {
    const systems = [
      { provisioned: false },
      { provisioned: undefined },
      {},
    ]
    const result = countSystemStatuses(systems)
    expect(result.live).toBe(0)
    expect(result.planned).toBe(3)
    expect(result.total).toBe(3)
  })

  it('correctly counts all-live systems', () => {
    const systems = [
      { provisioned: true },
      { url: 'https://acme.ainative.studio' },
      { provisioned: true, url: 'https://acme2.ainative.studio' },
    ]
    const result = countSystemStatuses(systems)
    expect(result.live).toBe(3)
    expect(result.planned).toBe(0)
    expect(result.total).toBe(3)
  })

  it('correctly counts mixed systems', () => {
    const systems = [
      { provisioned: true },
      { provisioned: false },
      { url: 'https://acme.ainative.studio' },
      {},
    ]
    const result = countSystemStatuses(systems)
    expect(result.live).toBe(2)
    expect(result.planned).toBe(2)
    expect(result.total).toBe(4)
  })

  it('total equals live + planned', () => {
    const systems = [
      { provisioned: true },
      {},
      { provisioned: false },
      { url: 'https://example.com' },
    ]
    const result = countSystemStatuses(systems)
    expect(result.live + result.planned).toBe(result.total)
  })
})

// ---------------------------------------------------------------------------
// Type coverage — ensure SystemStatus union is exhaustive
// ---------------------------------------------------------------------------

describe('SystemStatus type', () => {
  it('covers both "live" and "planned" states', () => {
    const states: SystemStatus[] = ['live', 'planned']
    expect(states).toHaveLength(2)
    // Every state must be a key in STATUS_BADGE
    for (const s of states) {
      expect(STATUS_BADGE[s]).toBeDefined()
    }
  })
})
