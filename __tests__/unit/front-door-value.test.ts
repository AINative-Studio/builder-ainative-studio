/**
 * Unit tests for front-door value-prop helpers (#65).
 *
 * Pure functions — no DOM, no React — so they run in the node vitest environment.
 */

import { describe, it, expect } from 'vitest'
import {
  FRONT_DOOR_VALUE_LINE,
  FRONT_DOOR_STEPS,
  liveStatusLine,
} from '@/lib/build/front-door-value'

describe('FRONT_DOOR_VALUE_LINE (#65)', () => {
  it('is a non-empty string', () => {
    expect(typeof FRONT_DOOR_VALUE_LINE).toBe('string')
    expect(FRONT_DOOR_VALUE_LINE.length).toBeGreaterThan(0)
  })

  it('mentions the key differentiators: own, built, run, no code', () => {
    const lower = FRONT_DOOR_VALUE_LINE.toLowerCase()
    expect(lower).toContain('own')
    expect(lower).toContain('built')
    expect(lower).toContain('run')
    expect(lower).toMatch(/no code/i)
  })

  it('starts with the Cody call-to-action', () => {
    expect(FRONT_DOOR_VALUE_LINE).toMatch(/^Tell Cody/)
  })
})

describe('FRONT_DOOR_STEPS (#65)', () => {
  it('has exactly 3 steps', () => {
    expect(FRONT_DOOR_STEPS).toHaveLength(3)
  })

  it('steps are numbered 1, 2, 3 sequentially', () => {
    expect(FRONT_DOOR_STEPS[0].step).toBe(1)
    expect(FRONT_DOOR_STEPS[1].step).toBe(2)
    expect(FRONT_DOOR_STEPS[2].step).toBe(3)
  })

  it('each step has a non-empty label and detail', () => {
    for (const s of FRONT_DOOR_STEPS) {
      expect(typeof s.label).toBe('string')
      expect(s.label.length).toBeGreaterThan(0)
      expect(typeof s.detail).toBe('string')
      expect(s.detail.length).toBeGreaterThan(0)
    }
  })

  it('step 1 mentions the idea', () => {
    expect(FRONT_DOOR_STEPS[0].label.toLowerCase()).toContain('idea')
  })

  it('step 2 mentions ownership', () => {
    const combined = (FRONT_DOOR_STEPS[1].label + ' ' + FRONT_DOOR_STEPS[1].detail).toLowerCase()
    expect(combined).toMatch(/own/)
  })

  it('step 3 conveys autonomous operation (runs itself)', () => {
    const combined = (FRONT_DOOR_STEPS[2].label + ' ' + FRONT_DOOR_STEPS[2].detail).toLowerCase()
    expect(combined).toMatch(/run/)
  })
})

describe('liveStatusLine (#65)', () => {
  it('includes the company name in the output', () => {
    const line = liveStatusLine('Acme Corp', true)
    expect(line).toContain('Acme Corp')
  })

  it('when onWatch=true, mentions Cody running it', () => {
    const line = liveStatusLine('Acme Corp', true)
    expect(line.toLowerCase()).toMatch(/cody/)
    expect(line.toLowerCase()).toMatch(/running/)
  })

  it('when onWatch=false, prompts the founder to upgrade', () => {
    const line = liveStatusLine('Acme Corp', false)
    expect(line.toLowerCase()).toMatch(/upgrade/)
  })

  it('returns a string for an empty company name (edge case)', () => {
    const line = liveStatusLine('', false)
    expect(typeof line).toBe('string')
    expect(line.length).toBeGreaterThan(0)
  })

  it('is different for onWatch=true vs onWatch=false', () => {
    const withWatch = liveStatusLine('TestCo', true)
    const withoutWatch = liveStatusLine('TestCo', false)
    expect(withWatch).not.toBe(withoutWatch)
  })
})
