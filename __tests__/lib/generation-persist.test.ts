import { describe, it, expect, vi } from 'vitest'
import { persistGeneration, type PersistInput } from '@/lib/generation-persist'

const base: PersistInput = {
  chatId: 'c1',
  prompt: 'build x',
  code: 'export default function App(){ return <div/>; }',
  model: 'm',
  status: 'success',
  valid: true,
}

describe('persistGeneration (#89)', () => {
  it('saves and returns saved on success', async () => {
    const save = vi.fn().mockResolvedValue(true)
    const r = await persistGeneration(base, save)
    expect(r).toEqual({ saved: true, reason: 'saved' })
    expect(save).toHaveBeenCalledOnce()
    expect(save.mock.calls[0][0]).toMatchObject({
      chatId: 'c1',
      generatedCode: base.code,
      codeLength: base.code.length,
    })
  })

  it('reports error when save returns false', async () => {
    const save = vi.fn().mockResolvedValue(false)
    const r = await persistGeneration(base, save)
    expect(r).toEqual({ saved: false, reason: 'error' })
  })

  it('reports error when save rejects (never throws)', async () => {
    const save = vi.fn().mockRejectedValue(new Error('zerodb down'))
    const r = await persistGeneration(base, save)
    expect(r).toEqual({ saved: false, reason: 'error' })
  })

  it('skips empty/whitespace code without calling save', async () => {
    const save = vi.fn()
    const r = await persistGeneration({ ...base, code: '   ' }, save)
    expect(r).toEqual({ saved: false, reason: 'skipped-empty' })
    expect(save).not.toHaveBeenCalled()
  })

  it('times out (bounded) if save hangs', async () => {
    const save = vi.fn(() => new Promise<boolean>(() => {})) // never resolves
    const r = await persistGeneration(base, save, { timeoutMs: 20 })
    expect(r).toEqual({ saved: false, reason: 'timeout' })
  })

  it('persists on the degraded path (status=degraded, invalid)', async () => {
    const save = vi.fn().mockResolvedValue(true)
    const r = await persistGeneration(
      { ...base, status: 'degraded', valid: false },
      save,
    )
    expect(r.saved).toBe(true)
    // degraded/invalid must NOT be flagged for showcase
    expect(save.mock.calls[0][0].isShowcase).toBe(false)
  })

  it('persists on the error path', async () => {
    const save = vi.fn().mockResolvedValue(true)
    const r = await persistGeneration({ ...base, status: 'error', valid: false }, save)
    expect(r.saved).toBe(true)
    expect(save.mock.calls[0][0].isShowcase).toBe(false)
  })

  it('flags isShowcase only for valid, substantial, successful code', async () => {
    const save = vi.fn().mockResolvedValue(true)
    const bigValid = { ...base, code: 'x'.repeat(2000) }
    await persistGeneration(bigValid, save)
    expect(save.mock.calls[0][0].isShowcase).toBe(true)
  })

  it('does NOT flag isShowcase for short valid code', async () => {
    const save = vi.fn().mockResolvedValue(true)
    await persistGeneration({ ...base, code: 'short but valid()' }, save)
    expect(save.mock.calls[0][0].isShowcase).toBe(false)
  })

  it('does NOT flag isShowcase for large-but-invalid code', async () => {
    const save = vi.fn().mockResolvedValue(true)
    await persistGeneration({ ...base, code: 'x'.repeat(2000), valid: false }, save)
    expect(save.mock.calls[0][0].isShowcase).toBe(false)
  })
})
