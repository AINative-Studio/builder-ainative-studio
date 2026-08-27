import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * builder#333 — durable files-map persistence in zerodb-store.
 *
 * saveGeneration must write the multi-file map as files_json alongside
 * generated_code (so multi-file apps restore the Sandpack path from the durable
 * store), skip oversized maps (~800KB row-size ceiling) with the code blob
 * still saved, and loadGeneration must rehydrate files_json tolerantly.
 */

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import { saveGeneration, loadGeneration } from '@/lib/zerodb-store'

function okResponse(payload: unknown = {}) {
  return { ok: true, json: async () => payload, text: async () => '' }
}

/** The row_data body of the most recent POST. */
function lastRowData(): Record<string, unknown> {
  const call = fetchMock.mock.calls.at(-1)!
  return JSON.parse(call[1].body).row_data
}

const baseGen = {
  chatId: 'chat-333',
  prompt: 'build beacon',
  generatedCode: 'export default function App(){ return <div/> }',
  model: 'test-model',
  codeLength: 46,
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(okResponse({}))
})

describe('saveGeneration files_json (#333)', () => {
  it('persists the files map as files_json when present', async () => {
    const files = {
      '/src/App.tsx': 'import S from "./components/S"\nexport default function App(){ return <S/> }',
      '/src/components/S.tsx': 'export default function S(){ return <aside/> }',
    }
    const ok = await saveGeneration({ ...baseGen, files })
    expect(ok).toBe(true)
    const row = lastRowData()
    expect(typeof row.files_json).toBe('string')
    expect(JSON.parse(row.files_json as string)).toEqual(files)
    expect(row.generated_code).toBe(baseGen.generatedCode)
  })

  it('omits files_json when no files map is given', async () => {
    await saveGeneration(baseGen)
    expect(lastRowData()).not.toHaveProperty('files_json')
  })

  it('omits files_json for an EMPTY files map', async () => {
    await saveGeneration({ ...baseGen, files: {} })
    expect(lastRowData()).not.toHaveProperty('files_json')
  })

  it('skips an oversized files map (>800KB) but still saves the row', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const huge = { '/src/App.tsx': 'x'.repeat(900_000) }
      const ok = await saveGeneration({ ...baseGen, files: huge })
      expect(ok).toBe(true)
      const row = lastRowData()
      expect(row).not.toHaveProperty('files_json')
      expect(row.generated_code).toBe(baseGen.generatedCode)
      expect(warn.mock.calls.some((c) => String(c[0]).includes('skipping durable files persist'))).toBe(true)
    } finally {
      warn.mockRestore()
    }
  })
})

describe('loadGeneration files rehydrate (#333)', () => {
  it('parses files_json back into a files map', async () => {
    const files = { '/src/App.tsx': 'export default function App(){ return <div/> }' }
    fetchMock.mockResolvedValue(
      okResponse({
        data: [
          {
            row_data: {
              prompt: 'p',
              generated_code: 'code',
              files_json: JSON.stringify(files),
            },
          },
        ],
      }),
    )
    const gen = await loadGeneration('chat-333')
    expect(gen?.files).toEqual(files)
    expect(gen?.generatedCode).toBe('code')
  })

  it('returns files: null when files_json is absent', async () => {
    fetchMock.mockResolvedValue(
      okResponse({ data: [{ row_data: { prompt: 'p', generated_code: 'code' } }] }),
    )
    const gen = await loadGeneration('chat-333')
    expect(gen?.files).toBeNull()
  })

  it('tolerates corrupt files_json (code blob still usable)', async () => {
    fetchMock.mockResolvedValue(
      okResponse({
        data: [{ row_data: { prompt: 'p', generated_code: 'code', files_json: '{not json' } }],
      }),
    )
    const gen = await loadGeneration('chat-333')
    expect(gen?.files).toBeNull()
    expect(gen?.generatedCode).toBe('code')
  })
})
