import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Real bug found live (repair-app's mechanical trailing-prose fix,
 * 2026-11-03): resolveStoredApp()'s in-memory branch returned `files: null`
 * whenever the per-instance files map (lib/preview-store-v2.ts) was empty —
 * even when a request's in-memory `code` blob was truthy (the replica had
 * served a render in between) AND the real multi-file map existed durably
 * in ZeroDB (populated by whichever replica originally ran generation).
 *
 * Confirmed live against the real "shoplo" company: POST /api/build/repair-app
 * returned {"ok":false,"recovered":false,"attempts":3} (fell through to the
 * expensive LLM loop) instead of the new mechanical fix, because `stored.files`
 * was null in production despite GET /api/generation/{id}/files (which reads
 * ZeroDB directly) returning a real files map for the same chatId.
 */

const getPreview = vi.fn<(id: string) => string | undefined>()
const getFilesV2 = vi.fn<(id: string) => Record<string, string> | null>()
const loadGeneration = vi.fn<
  (id: string) => Promise<{ prompt: string; generatedCode: string; files?: Record<string, string> | null } | null>
>()

vi.mock('@/lib/preview-store', () => ({ getPreview: (id: string) => getPreview(id) }))
vi.mock('@/lib/preview-store-v2', () => ({ getFiles: (id: string) => getFilesV2(id) }))
vi.mock('@/lib/zerodb-store', () => ({ loadGeneration: (id: string) => loadGeneration(id) }))

import { resolveStoredApp } from '@/lib/build/ready-gate'

beforeEach(() => {
  getPreview.mockReset()
  getFilesV2.mockReset()
  loadGeneration.mockReset()
})

describe('resolveStoredApp: requireFiles backfills the durable files map on a cross-instance miss', () => {
  it('returns files:null (no backfill) when requireFiles is not set — the default/cheap path', async () => {
    getPreview.mockReturnValue('const App = () => null')
    getFilesV2.mockReturnValue(null)

    const result = await resolveStoredApp('chat-1')

    expect(result).toEqual({ code: 'const App = () => null', files: null })
    expect(loadGeneration).not.toHaveBeenCalled()
  })

  it('backfills files from the durable store when requireFiles:true and the in-memory map is empty (the real shoplo shape)', async () => {
    getPreview.mockReturnValue('const App = () => null') // this replica served a render, but
    getFilesV2.mockReturnValue(null) // never ran this chatId's original generation
    loadGeneration.mockResolvedValue({
      prompt: 'x',
      generatedCode: 'irrelevant',
      files: { '/src/App.tsx': 'real durable content' },
    })

    const result = await resolveStoredApp('chat-cross-instance', { requireFiles: true })

    expect(result).toEqual({
      code: 'const App = () => null',
      files: { '/src/App.tsx': 'real durable content' },
    })
    expect(loadGeneration).toHaveBeenCalledWith('chat-cross-instance')
  })

  it('does NOT backfill when the in-memory files map is already populated — no wasted round-trip', async () => {
    getPreview.mockReturnValue('const App = () => null')
    getFilesV2.mockReturnValue({ '/src/App.tsx': 'already have this' })

    const result = await resolveStoredApp('chat-same-instance', { requireFiles: true })

    expect(result).toEqual({ code: 'const App = () => null', files: { '/src/App.tsx': 'already have this' } })
    expect(loadGeneration).not.toHaveBeenCalled()
  })

  it('falls back to in-memory-only (files unchanged) when the durable backfill throws — never blocks on a store outage', async () => {
    getPreview.mockReturnValue('const App = () => null')
    getFilesV2.mockReturnValue(null)
    loadGeneration.mockRejectedValue(new Error('ZeroDB timeout'))

    const result = await resolveStoredApp('chat-outage', { requireFiles: true })

    expect(result).toEqual({ code: 'const App = () => null', files: null })
  })

  it('falls back to in-memory-only when the durable copy has no files map either', async () => {
    getPreview.mockReturnValue('const App = () => null')
    getFilesV2.mockReturnValue(null)
    loadGeneration.mockResolvedValue({ prompt: 'x', generatedCode: 'irrelevant', files: null })

    const result = await resolveStoredApp('chat-no-durable-files', { requireFiles: true })

    expect(result).toEqual({ code: 'const App = () => null', files: null })
  })
})
