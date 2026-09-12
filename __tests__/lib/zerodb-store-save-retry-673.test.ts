import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Real bug found live (builder#673): saveGeneration called zerodbRequest with
 * NO retry options, so a single transient 401/429/5xx meant the generation's
 * code was NEVER durably persisted — permanently, since nothing else ever
 * retries this write. Confirmed live: chili-crate-product's real, successful
 * generation existed only in the in-memory preview store; the durable
 * `generations` table had zero rows for it, hours later.
 */

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import { saveGeneration } from '@/lib/zerodb-store'

function okResponse(payload: unknown = {}) {
  return { ok: true, json: async () => payload, text: async () => '' }
}
function failResponse(status: number) {
  return { ok: false, status, text: async () => 'server error' }
}

const baseGen = {
  chatId: 'chat-retry-673',
  prompt: 'build a retry-tolerant app',
  generatedCode: 'export default function App(){ return <div/> }',
  model: 'test-model',
  codeLength: 46,
}

beforeEach(() => {
  fetchMock.mockReset()
})

describe('saveGeneration retries on transient failure (#673)', () => {
  it('succeeds after one transient 500, using the built-in retry', async () => {
    fetchMock
      .mockResolvedValueOnce(failResponse(500))
      .mockResolvedValueOnce(okResponse({}))
    const ok = await saveGeneration(baseGen)
    expect(ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('succeeds on the first real network throw, retried once', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValueOnce(okResponse({}))
    const ok = await saveGeneration(baseGen)
    expect(ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('still returns false (never throws) when both the original attempt and the retry fail', async () => {
    fetchMock
      .mockResolvedValueOnce(failResponse(500))
      .mockResolvedValueOnce(failResponse(500))
    const ok = await saveGeneration(baseGen)
    expect(ok).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry a genuine 4xx client error (retrying would never fix it)', async () => {
    fetchMock.mockResolvedValueOnce(failResponse(400))
    const ok = await saveGeneration(baseGen)
    expect(ok).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('logs loudly (console.error, not console.warn) on a final, unrecovered save failure', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock
      .mockResolvedValueOnce(failResponse(500))
      .mockResolvedValueOnce(failResponse(500))
    await saveGeneration(baseGen)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('PERSIST FAILURE'))
    errorSpy.mockRestore()
  })
})
