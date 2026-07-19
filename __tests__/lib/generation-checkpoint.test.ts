import { describe, it, expect } from 'vitest'
import {
  GenerationCheckpoint,
  resolveDegradation,
} from '@/lib/generation-checkpoint'

describe('GenerationCheckpoint (#81)', () => {
  it('starts empty', () => {
    const cp = new GenerationCheckpoint()
    expect(cp.hasValid()).toBe(false)
    expect(cp.get()).toBeNull()
  })

  it('records a valid stage', () => {
    const cp = new GenerationCheckpoint()
    cp.record('initial', 'const App = () => <div/>', true)
    expect(cp.hasValid()).toBe(true)
    expect(cp.get()).toEqual({ code: 'const App = () => <div/>', stage: 'initial' })
  })

  it('ignores invalid stages', () => {
    const cp = new GenerationCheckpoint()
    cp.record('initial', 'broken(;', false)
    expect(cp.hasValid()).toBe(false)
  })

  it('ignores empty/whitespace code even if flagged valid', () => {
    const cp = new GenerationCheckpoint()
    cp.record('initial', '   ', true)
    expect(cp.hasValid()).toBe(false)
  })

  it('the latest valid stage wins', () => {
    const cp = new GenerationCheckpoint()
    cp.record('initial', 'v1', true)
    cp.record('retry', 'v2', true)
    expect(cp.get()).toEqual({ code: 'v2', stage: 'retry' })
  })

  it('a later INVALID stage does not clobber an earlier valid checkpoint', () => {
    const cp = new GenerationCheckpoint()
    cp.record('initial', 'good', true)
    cp.record('retry', 'regressed(;', false)
    expect(cp.get()).toEqual({ code: 'good', stage: 'initial' })
  })
})

describe('resolveDegradation (#81)', () => {
  it('serves current code when it is valid', () => {
    const cp = new GenerationCheckpoint()
    const out = resolveDegradation('current code', true, cp)
    expect(out).toEqual({ kind: 'current', code: 'current code' })
  })

  it('serves the checkpoint when current is invalid but a valid version exists', () => {
    const cp = new GenerationCheckpoint()
    cp.record('initial', 'earlier working', true)
    const out = resolveDegradation('broken(;', false, cp)
    expect(out).toEqual({ kind: 'checkpoint', code: 'earlier working', stage: 'initial' })
  })

  it('falls back when current is invalid and there is no checkpoint', () => {
    const cp = new GenerationCheckpoint()
    const out = resolveDegradation('broken(;', false, cp)
    expect(out).toEqual({ kind: 'fallback' })
  })

  it('falls back when current is valid-but-empty and no checkpoint', () => {
    const cp = new GenerationCheckpoint()
    const out = resolveDegradation('   ', true, cp)
    expect(out.kind).toBe('fallback')
  })

  it('prefers current over checkpoint when both are valid', () => {
    const cp = new GenerationCheckpoint()
    cp.record('initial', 'old', true)
    const out = resolveDegradation('new valid', true, cp)
    expect(out).toEqual({ kind: 'current', code: 'new valid' })
  })
})
