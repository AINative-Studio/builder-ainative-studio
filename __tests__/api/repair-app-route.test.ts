import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * POST /api/build/repair-app — real bug fix (follow-up to #564): register-app's
 * 422 rejection carries `retry:true` and the exact parse error, but NOTHING
 * consumed it before this route existed. A founder whose build hit
 * checkAppReady's pre-deploy parse gate (a real, live, recurring failure mode —
 * confirmed via genuine E2E verification against production) was stuck forever
 * on a broken build with no path forward. This route actually repairs the
 * STORED broken code (same repair-loop shape chat-ws uses for its own
 * in-request retries) and persists the fix so the next register-app call sees
 * working code.
 */

const h = vi.hoisted(() => ({
  resolveStoredApp: vi.fn(),
  storePreview: vi.fn(),
  storeFiles: vi.fn(),
  saveGeneration: vi.fn(),
  createCompletion: vi.fn(),
}))

vi.mock('@/lib/build/ready-gate', () => ({ resolveStoredApp: h.resolveStoredApp }))
vi.mock('@/lib/preview-store', () => ({ storePreview: h.storePreview }))
vi.mock('@/lib/preview-store-v2', () => ({ storeFiles: h.storeFiles }))
vi.mock('@/lib/zerodb-store', () => ({ saveGeneration: h.saveGeneration }))
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: h.createCompletion } }
  },
}))

import { POST } from '@/app/api/build/repair-app/route'

function postReq(body: unknown) {
  return { json: async () => body } as any
}

// runValidationRetryLoop skips any generated attempt <= 500 chars (real
// generations are hundreds of lines; this guards against a truncated/empty
// response looking "worth validating") — pad both fixtures past that floor.
// Unclosed JSX (not an unterminated template) is the reliably-caught defect —
// Babel's parser tolerates the latter in this exact shape.
const PADDING = '  // filler line to realistically exceed the 500-char floor\n'.repeat(15)
const BROKEN_CODE = `function App(){\n${PADDING}  return <div><span>unclosed\n}`
const FIXED_CODE = `function App(){\n${PADDING}  return <div><span>closed</span></div>\n}`

beforeEach(() => {
  vi.clearAllMocks()
  h.resolveStoredApp.mockResolvedValue({ code: BROKEN_CODE, files: null })
  h.storeFiles.mockReturnValue(undefined)
  h.storePreview.mockReturnValue(undefined)
  h.saveGeneration.mockResolvedValue(true)
})

describe('POST /api/build/repair-app', () => {
  it('requires a chatId', async () => {
    const res: any = await POST(postReq({ error: 'x' }))
    expect(res.status).toBe(400)
  })

  it('returns ok:false honestly when there is no stored code to repair', async () => {
    h.resolveStoredApp.mockResolvedValue(null)
    const res: any = await POST(postReq({ chatId: 'c1', error: 'Unexpected token (10:2)' }))
    const json = await res.json()
    expect(json).toEqual({ ok: false, reason: 'no_stored_code' })
  })

  it('repairs the stored code, persists it, and reports recovered:true', async () => {
    h.createCompletion.mockResolvedValue({
      choices: [{ message: { content: '```jsx\n' + FIXED_CODE + '\n```' } }],
    })
    const res: any = await POST(postReq({ chatId: 'c1', error: 'Unterminated template (2:15)' }))
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.recovered).toBe(true)
    expect(h.storePreview).toHaveBeenCalledWith('c1', expect.stringContaining('</span>'))
    expect(h.saveGeneration).toHaveBeenCalledWith(expect.objectContaining({ chatId: 'c1' }))
  })

  it('reports recovered:false honestly when every repair attempt still fails validation', async () => {
    h.createCompletion.mockResolvedValue({
      choices: [{ message: { content: '```jsx\n' + BROKEN_CODE + '\n```' } }], // still broken
    })
    const res: any = await POST(postReq({ chatId: 'c1', error: 'Unterminated template (2:15)' }))
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.recovered).toBe(false)
    expect(h.storePreview).not.toHaveBeenCalled()
  })

  it('never throws when the model call itself fails — surfaces ok:false', async () => {
    h.createCompletion.mockRejectedValue(new Error('model unavailable'))
    const res: any = await POST(postReq({ chatId: 'c1', error: 'Unterminated template (2:15)' }))
    const json = await res.json()
    expect(json.ok).toBe(false)
  })
})
