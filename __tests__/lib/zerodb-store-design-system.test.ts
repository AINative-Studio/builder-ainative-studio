import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Real bug found live (Meridian, https://builder.ainative.studio/build/meridian,
 * 2026-09-10): the founder's chosen design system was correctly persisted in
 * the in-memory preview store (lib/preview-store.ts), but never reached the
 * DURABLE ZeroDB store at all — saveGeneration/loadGeneration had no
 * designSystemId field. Any request whose GET /api/preview/[id] landed on a
 * DIFFERENT Railway replica than the one that ran the generation (in-memory
 * state is per-process; this is a real, confirmed multi-instance production
 * deployment) fell through to the ZeroDB restore path in
 * app/api/preview/[id]/route.ts, which had nothing to restore — the served
 * page silently reverted to plain Inter/Poppins defaults regardless of what
 * was actually chosen, even though the server correctly logged "Design
 * system chosen" at generation time.
 */

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import { saveGeneration, loadGeneration } from '@/lib/zerodb-store'

function okResponse(payload: unknown = {}) {
  return { ok: true, json: async () => payload, text: async () => '' }
}

function lastRowData(): Record<string, unknown> {
  const call = fetchMock.mock.calls.at(-1)!
  return JSON.parse(call[1].body).row_data
}

const baseGen = {
  chatId: 'chat-meridian',
  prompt: 'build meridian landing page',
  generatedCode: 'export default function App(){ return <div/> }',
  model: 'test-model',
  codeLength: 46,
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(okResponse({}))
})

describe('saveGeneration persists designSystemId (2026-09-10 fix)', () => {
  it('writes design_system_id when a design system was chosen', async () => {
    const ok = await saveGeneration({ ...baseGen, designSystemId: 'cloud' })
    expect(ok).toBe(true)
    const row = lastRowData()
    expect(row.design_system_id).toBe('cloud')
  })

  it('omits design_system_id when no design system was chosen', async () => {
    const ok = await saveGeneration({ ...baseGen })
    expect(ok).toBe(true)
    const row = lastRowData()
    expect(row.design_system_id).toBeUndefined()
  })
})

describe('loadGeneration rehydrates designSystemId (2026-09-10 fix)', () => {
  it('returns the persisted designSystemId', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        data: [
          {
            row_data: {
              chat_id: 'chat-meridian',
              prompt: 'build meridian',
              generated_code: 'export default function App(){}',
              code_length: 33,
              design_system_id: 'cloud',
            },
          },
        ],
      }),
    )
    const gen = await loadGeneration('chat-meridian')
    expect(gen?.designSystemId).toBe('cloud')
  })

  it('returns undefined designSystemId (not null/empty-string) when none was persisted', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        data: [
          {
            row_data: {
              chat_id: 'chat-meridian',
              prompt: 'build meridian',
              generated_code: 'export default function App(){}',
              code_length: 33,
            },
          },
        ],
      }),
    )
    const gen = await loadGeneration('chat-meridian')
    expect(gen?.designSystemId).toBeUndefined()
  })
})
