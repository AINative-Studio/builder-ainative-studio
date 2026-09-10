import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { getDesignSystem } from '@/lib/design-systems/catalog'

/**
 * Batch 2 import (#595) — drafting, episode, fjord, frost, gazette, graph,
 * guardrail, harness. Verifies the catalog entries transcribed into
 * lib/design-systems/catalog.ts are byte-identical to the real theme.json
 * files in the source asset drop, rather than trusting hand-transcription.
 *
 * The source drop lives outside the repo
 * (~/Downloads/Design systems for builder product/systems/<id>/theme.json)
 * and won't exist in CI — guard with an existence check and skip gracefully
 * rather than fail when it's absent.
 */

const SOURCE_ROOT = path.join(
  process.env.HOME || '',
  'Downloads/Design systems for builder product/systems',
)

const BATCH2_IDS = [
  'drafting',
  'episode',
  'fjord',
  'frost',
  'gazette',
  'graph',
  'guardrail',
  'harness',
] as const

const sourceDirExists = fs.existsSync(SOURCE_ROOT)

describe.skipIf(!sourceDirExists)('DESIGN_SYSTEMS catalog — batch 2 transcription fidelity', () => {
  for (const id of BATCH2_IDS) {
    it(`${id}: catalog entry matches theme.json exactly`, () => {
      const themePath = path.join(SOURCE_ROOT, id, 'theme.json')
      expect(fs.existsSync(themePath)).toBe(true)

      const theme = JSON.parse(fs.readFileSync(themePath, 'utf-8'))
      const entry = getDesignSystem(id)
      expect(entry).toBeDefined()

      expect(entry!.palette.bg).toBe(theme.palette.bg)
      expect(entry!.palette.surface).toBe(theme.palette.surface)
      expect(entry!.palette.text).toBe(theme.palette.text)
      expect(entry!.palette.accent).toBe(theme.palette.accent)
      expect(entry!.palette.accent2).toBe(theme.palette.accent2)

      expect(entry!.fonts.heading.family).toBe(theme.fonts.heading.family)
      expect(entry!.fonts.heading.weights).toEqual(theme.fonts.heading.weights)
      expect(entry!.fonts.body.family).toBe(theme.fonts.body.family)
      expect(entry!.fonts.body.weights).toEqual(theme.fonts.body.weights)

      expect(entry!.radius).toBe(theme.radius)
      expect(entry!.shadows).toBe(theme.shadows)

      if (theme.palette.status) {
        expect(entry!.palette.status).toEqual(theme.palette.status)
      } else {
        expect(entry!.palette.status).toBeUndefined()
      }
    })
  }
})
