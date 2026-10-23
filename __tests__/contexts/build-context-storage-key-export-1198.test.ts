import { describe, it, expect } from 'vitest'
import { buildStateStorageKey } from '@/contexts/build-context'

/**
 * #1198 — exported so a test-only seam (e2e/helpers/session-restore.ts) can
 * write a localStorage entry under the EXACT key saveBuildState/
 * loadBuildState themselves use, instead of a hand-maintained duplicate of
 * the `ainative_build_<slug>` prefix that could silently drift if this file
 * ever changes it. Covered here as a plain contract test: whatever the
 * prefix is, this function is the single source of truth for it.
 */
describe('buildStateStorageKey (#1198 test-seam export)', () => {
  it('namespaces a company slug under the real build-state localStorage prefix', () => {
    expect(buildStateStorageKey('acme-roofing')).toBe('ainative_build_acme-roofing')
  })

  it('is stable/deterministic for the same slug', () => {
    expect(buildStateStorageKey('ridgeline')).toBe(buildStateStorageKey('ridgeline'))
  })

  it('distinguishes different slugs', () => {
    expect(buildStateStorageKey('a')).not.toBe(buildStateStorageKey('b'))
  })
})
