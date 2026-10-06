import { describe, it, expect } from 'vitest'
import { ARTIFACT_TITLES } from '@/lib/build/titles'

describe('ARTIFACT_TITLES — plain language (#BLD-08)', () => {
  it('dataModel, memoryPolicy, thesis, wedge no longer use internal jargon', () => {
    expect(ARTIFACT_TITLES.dataModel).not.toBe('Data Model')
    expect(ARTIFACT_TITLES.memoryPolicy).not.toBe('Memory Policy')
    expect(ARTIFACT_TITLES.thesis).not.toBe('Venture Thesis')
    expect(ARTIFACT_TITLES.wedge).not.toBe('Initial Wedge')
    expect(ARTIFACT_TITLES.dataModel).toMatch(/your|the/i)
  })
})
