import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { DESIGN_SYSTEMS } from '@/lib/design-systems/catalog'

/**
 * Final completeness check for the whole Design System Picker epic (#590-#595).
 * After batch 4, all 40 real imported systems from the source drop should
 * have a matching catalog entry.
 *
 * DESIGN_SYSTEMS itself has 41 entries, not 40: 'modernist' is Builder's own
 * pre-existing look (series 'builder'), not one of the 40 systems imported
 * from the source drop, and has no directory there — see its comment in
 * catalog.ts and the `brandBound`/`series` doc comments in types.ts. So the
 * real invariant is "40 source directories => 40 matching catalog entries",
 * asserted as DESIGN_SYSTEMS.length === sourceDirs.length + 1 (the +1 being
 * modernist), rather than fabricating a bare `=== 40` that doesn't match the
 * actual data.
 *
 * The source drop lives outside the repo
 * (~/Downloads/Design systems for builder product/systems/<id>)
 * and won't exist in CI — guard with an existence check and skip gracefully
 * rather than fail when it's absent.
 */

const SOURCE_ROOT = path.join(
  process.env.HOME || '',
  'Downloads/Design systems for builder product/systems',
)

const sourceDirExists = fs.existsSync(SOURCE_ROOT)

describe.skipIf(!sourceDirExists)('DESIGN_SYSTEMS catalog — full 40-system completeness', () => {
  it('has exactly 40 imported systems plus the pre-existing modernist entry (41 total)', () => {
    const realDirs = fs
      .readdirSync(SOURCE_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)

    expect(realDirs.length).toBe(40)
    expect(DESIGN_SYSTEMS.length).toBe(41)
  })

  it('has a catalog entry for every real system directory in the source drop', () => {
    const realDirs = fs
      .readdirSync(SOURCE_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()

    const catalogIds = DESIGN_SYSTEMS.map((s) => s.id).sort()
    const catalogIdsExcludingModernist = catalogIds.filter((id) => id !== 'modernist')

    for (const dir of realDirs) {
      expect(catalogIds).toContain(dir)
    }

    expect(catalogIdsExcludingModernist).toEqual(realDirs)
  })
})
