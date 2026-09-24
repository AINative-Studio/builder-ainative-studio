import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GenerationCheckpoint } from '@/lib/generation-checkpoint'
import {
  registerInFlightGeneration,
  unregisterInFlightGeneration,
  inFlightCount,
  flushInFlightGenerations,
  type InFlightGeneration,
} from '@/lib/generation-shutdown-flush'

/**
 * Real, confirmed incident (builder#865): evan@ainative.studio's "flashpoint"
 * generation was running when an ordinary main-branch deploy landed (Railway
 * restarts the process on every deploy). `persistGeneration()` is only ever
 * called from chat-ws's own success/degraded terminal branches — a process
 * kill mid-generation never reaches either one, so NOTHING was ever
 * persisted: confirmed live via direct ZeroDB queries showing zero rows in
 * both the `generations` and `build_chat` tables, across three separate
 * provisioning attempts spanning the exact window a deploy landed in.
 */

function makeEntry(chatId: string, cpStage: string | null, code = 'export default function App(){return <div/>}'): InFlightGeneration {
  const checkpoint = new GenerationCheckpoint()
  if (cpStage) checkpoint.record(cpStage, code, true)
  return { chatId, prompt: 'build x', model: 'test-model', checkpoint }
}

describe('registerInFlightGeneration / unregisterInFlightGeneration / inFlightCount', () => {
  it('register adds an entry, unregister removes it', () => {
    const before = inFlightCount()
    registerInFlightGeneration(makeEntry('reg-1', 'initial'))
    expect(inFlightCount()).toBe(before + 1)
    unregisterInFlightGeneration('reg-1')
    expect(inFlightCount()).toBe(before)
  })

  it('registering with an empty chatId is a no-op (never tracked, never flushed)', () => {
    const before = inFlightCount()
    registerInFlightGeneration(makeEntry('', 'initial'))
    expect(inFlightCount()).toBe(before)
  })

  it('unregistering a chatId that was never registered is a harmless no-op', () => {
    const before = inFlightCount()
    unregisterInFlightGeneration('never-registered-xyz')
    expect(inFlightCount()).toBe(before)
  })

  it('re-registering the same chatId replaces rather than duplicates', () => {
    const before = inFlightCount()
    registerInFlightGeneration(makeEntry('dup-1', 'initial'))
    registerInFlightGeneration(makeEntry('dup-1', 'retry'))
    expect(inFlightCount()).toBe(before + 1)
    unregisterInFlightGeneration('dup-1')
    expect(inFlightCount()).toBe(before)
  })
})

describe('flushInFlightGenerations', () => {
  it('persists the checkpointed code for every entry with a valid checkpoint', async () => {
    const save = vi.fn().mockResolvedValue(true)
    const entries = [makeEntry('c1', 'initial', 'code-1'), makeEntry('c2', 'retry', 'code-2')]
    const flushed = await flushInFlightGenerations(entries, save)
    expect(flushed.sort()).toEqual(['c1', 'c2'])
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls.find((c) => c[0].chatId === 'c1')?.[0]).toMatchObject({
      chatId: 'c1',
      generatedCode: 'code-1',
      model: 'test-model',
    })
  })

  it('skips an entry with no valid checkpoint yet (nothing to flush, not an error)', async () => {
    const save = vi.fn().mockResolvedValue(true)
    const entries = [makeEntry('empty-1', null)]
    const flushed = await flushInFlightGenerations(entries, save)
    expect(flushed).toEqual([])
    expect(save).not.toHaveBeenCalled()
  })

  it('a failed save for one entry does not affect another entry flushing successfully', async () => {
    const save = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(false))
      .mockImplementationOnce(() => Promise.resolve(true))
    const entries = [makeEntry('fail-1', 'initial'), makeEntry('ok-1', 'initial')]
    const flushed = await flushInFlightGenerations(entries, save)
    expect(flushed).toEqual(['ok-1'])
  })

  it('a save that throws is treated as a failed flush, never crashes the batch', async () => {
    const save = vi.fn().mockRejectedValue(new Error('zerodb down'))
    const entries = [makeEntry('throws-1', 'initial')]
    const flushed = await flushInFlightGenerations(entries, save)
    expect(flushed).toEqual([])
  })

  it('flushes the LATEST checkpointed stage, not the first — mirrors GenerationCheckpoint.record()\'s own "only the last valid" contract', async () => {
    const save = vi.fn().mockResolvedValue(true)
    const checkpoint = new GenerationCheckpoint()
    checkpoint.record('initial', 'code-v1', true)
    checkpoint.record('retry', 'code-v2', true)
    const entries: InFlightGeneration[] = [{ chatId: 'staged-1', prompt: 'p', model: 'm', checkpoint }]
    await flushInFlightGenerations(entries, save)
    expect(save.mock.calls[0][0].generatedCode).toBe('code-v2')
  })

  it('an empty entries list flushes nothing and never calls save', async () => {
    const save = vi.fn()
    const flushed = await flushInFlightGenerations([], save)
    expect(flushed).toEqual([])
    expect(save).not.toHaveBeenCalled()
  })
})
