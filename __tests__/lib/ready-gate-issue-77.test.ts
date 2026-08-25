import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * builder#77 — checkAppReady() (the "mark ready" seam gate).
 *
 * Verifies the gate blocks a broken app, passes a good one, and FAILS OPEN when the
 * code can't be found (store miss) so a transient store outage never blocks a
 * legitimate deploy. Code is resolved from the in-memory preview store first, then
 * the durable ZeroDB copy — both are mocked here.
 */

const getPreview = vi.fn<(id: string) => string | undefined>()
const loadGeneration = vi.fn<
  (id: string) => Promise<{ prompt: string; generatedCode: string; ssrHtml?: string } | null>
>()

vi.mock('@/lib/preview-store', () => ({ getPreview: (id: string) => getPreview(id) }))
vi.mock('@/lib/zerodb-store', () => ({ loadGeneration: (id: string) => loadGeneration(id) }))

import { checkAppReady } from '@/lib/build/ready-gate'

const GOOD_APP = `function App() {
  const [count, setCount] = useState(0)
  return <Button onClick={() => setCount(count + 1)}>{count}</Button>
}`

const BROKEN_APP = `function App() {\n  return <div><NonexistentThing /></div>\n}`

beforeEach(() => {
  getPreview.mockReset()
  loadGeneration.mockReset()
})

describe('builder#77 checkAppReady', () => {
  it('passes a valid app from the in-memory preview store', async () => {
    getPreview.mockReturnValue(GOOD_APP)
    const r = await checkAppReady('chat-good')
    expect(r.checked).toBe(true)
    expect(r.ok).toBe(true)
    expect(loadGeneration).not.toHaveBeenCalled()
  })

  it('BLOCKS a broken app (hallucinated component) from the preview store', async () => {
    getPreview.mockReturnValue(BROKEN_APP)
    const r = await checkAppReady('chat-broken')
    expect(r.checked).toBe(true)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('unresolved_component')
  })

  it('falls back to ZeroDB when the preview store is empty', async () => {
    getPreview.mockReturnValue(undefined)
    loadGeneration.mockResolvedValue({ prompt: 'x', generatedCode: GOOD_APP })
    const r = await checkAppReady('chat-durable')
    expect(loadGeneration).toHaveBeenCalledWith('chat-durable')
    expect(r.checked).toBe(true)
    expect(r.ok).toBe(true)
  })

  it('BLOCKS a broken app resolved from the durable ZeroDB copy', async () => {
    getPreview.mockReturnValue(undefined)
    loadGeneration.mockResolvedValue({ prompt: 'x', generatedCode: BROKEN_APP })
    const r = await checkAppReady('chat-durable-broken')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('unresolved_component')
  })

  it('FAILS OPEN (checked:false, ok:true) when no code is found anywhere', async () => {
    getPreview.mockReturnValue(undefined)
    loadGeneration.mockResolvedValue(null)
    const r = await checkAppReady('chat-missing')
    expect(r.checked).toBe(false)
    expect(r.ok).toBe(true)
  })

  it('FAILS OPEN when the durable store throws (store outage never blocks)', async () => {
    getPreview.mockReturnValue(undefined)
    loadGeneration.mockRejectedValue(new Error('ZeroDB timeout'))
    const r = await checkAppReady('chat-outage')
    expect(r.checked).toBe(false)
    expect(r.ok).toBe(true)
  })

  it('ignores blank in-memory content and consults the durable store', async () => {
    getPreview.mockReturnValue('   ')
    loadGeneration.mockResolvedValue({ prompt: 'x', generatedCode: GOOD_APP })
    const r = await checkAppReady('chat-blank-mem')
    expect(loadGeneration).toHaveBeenCalled()
    expect(r.ok).toBe(true)
  })
})
