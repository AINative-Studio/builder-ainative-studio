import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * POST /api/build/ask — real multimodal message-building (#741). Before this,
 * even after chat-upload UI existed, the actual Claude call sent plain-string
 * message content — no Anthropic image content blocks — so an "uploaded"
 * image was invisible to Cody under the hood. These tests mock the Claude
 * call and assert REAL `{type: 'image', source: {...}}` content blocks are
 * constructed when an attachment is present on the request, that a
 * non-image document degrades to an honest text mention (never fabricated
 * content), and that the old hardcoded "no upload" denial is gone.
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActivePlan: vi.fn(),
  resolveApp: vi.fn(),
  loadChatWithFallback: vi.fn(),
  saveExchange: vi.fn(),
  processConversation: vi.fn(),
  getClaudeCompletion: vi.fn(),
  fetchFileDownload: vi.fn(),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/ainative/active-plan', () => ({ resolveActivePlan: h.resolveActivePlan }))
vi.mock('@/lib/build/app-registry', () => ({ resolveApp: h.resolveApp }))
vi.mock('@/lib/build/chat-store', async () => {
  const actual = await vi.importActual<typeof import('@/lib/build/chat-store')>('@/lib/build/chat-store')
  return {
    ...actual,
    deriveOwnerKey: () => 'guest:anon',
    chatScopeKey: (owner: string, slug: string) => `${owner}::${slug}`,
    loadChatWithFallback: h.loadChatWithFallback,
    saveExchange: h.saveExchange,
    // Use the REAL buildMessagesWithHistory — that's the function under test here.
  }
})
vi.mock('@/lib/build/media-schedule', () => ({ fetchFileDownload: h.fetchFileDownload }))
vi.mock('@/lib/agent/zeromemory', () => ({ processConversation: h.processConversation }))
vi.mock('@/lib/build/claude-completion', () => ({ getClaudeCompletion: h.getClaudeCompletion }))
vi.mock('@/lib/build/chat-summary', () => ({ ensureChatSummary: vi.fn(async () => null) }))

import { POST } from '@/app/api/build/ask/route'

function req(body: unknown) {
  return { json: async () => body, url: 'https://builder.ainative.studio/api/build/ask' } as any
}

function fakeClaude(answer: string) {
  const create = vi.fn(async (_args: { system: string; messages: Array<{ role: string; content: unknown }> }) => ({
    content: [{ type: 'text', text: answer }],
  }))
  return { provider: 'anthropic' as const, model: 'claude-x', client: { messages: { create } }, create }
}

const IMAGE_ATTACHMENT = { fileId: 'f-1', url: '/api/build/media/upload?id=f-1', contentType: 'image/png', fileName: 'storefront.png' }
const DOC_ATTACHMENT = { fileId: 'f-2', url: '/api/build/documents/upload?id=f-2', contentType: 'application/pdf', fileName: 'brief.pdf' }

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset())
  h.auth.mockResolvedValue(null)
  h.resolveActivePlan.mockResolvedValue({ plan: '', verified: true })
  h.resolveApp.mockResolvedValue(null)
  h.loadChatWithFallback.mockResolvedValue([])
  h.saveExchange.mockResolvedValue(true)
  h.processConversation.mockResolvedValue(undefined)
  // The backlog fetch inside the route also uses global fetch — stub it to a
  // benign failure so it doesn't interfere (route treats a failed backlog
  // fetch as "no backlog block", never an error).
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/files/') && String(url).includes('/download')) {
      throw new Error('unexpected direct fetch — should go through fetchFileDownload mock')
    }
    return { ok: false } as any
  }))
})

describe('POST /api/build/ask — real multimodal content blocks (#741)', () => {
  it('sends a real Anthropic image content block when an image attachment is present', async () => {
    h.fetchFileDownload.mockResolvedValue({ url: 'https://bucket.example.com/presigned-storefront.png', contentType: 'image/png' })
    // Override the global fetch stub just for the presigned bucket download.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('https://bucket.example.com/')) {
        return { ok: true, arrayBuffer: async () => new TextEncoder().encode('fake-png-bytes').buffer } as any
      }
      return { ok: false } as any
    }))
    const claude = fakeClaude('I can see the storefront photo.')
    h.getClaudeCompletion.mockReturnValue(claude)

    const res = await POST(req({
      question: 'what do you think of this?',
      idea: 'a coffee shop',
      companyId: 'brew-co',
      attachments: [IMAGE_ATTACHMENT],
    }))
    const json = await res.json()

    expect(json.answer).toBe('I can see the storefront photo.')
    expect(h.fetchFileDownload).toHaveBeenCalledWith('f-1')
    const callArgs = claude.create.mock.calls[0][0]
    const lastMessage: any = callArgs.messages[callArgs.messages.length - 1]
    expect(Array.isArray(lastMessage.content)).toBe(true)
    const imageBlock = lastMessage.content.find((b: any) => b.type === 'image')
    expect(imageBlock).toBeDefined()
    expect(imageBlock.source.type).toBe('base64')
    expect(imageBlock.source.media_type).toBe('image/png')
    expect(typeof imageBlock.source.data).toBe('string')
    expect(imageBlock.source.data.length).toBeGreaterThan(0)
    const textBlock = lastMessage.content.find((b: any) => b.type === 'text')
    expect(textBlock.text).toBe('what do you think of this?')
  })

  it('persists the attachment on the saved user turn', async () => {
    h.fetchFileDownload.mockResolvedValue({ url: 'https://bucket.example.com/x.png', contentType: 'image/png' })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as any)))
    h.getClaudeCompletion.mockReturnValue(fakeClaude('Got it.'))

    await POST(req({ question: 'look', idea: 'x', companyId: 'brew-co', attachments: [IMAGE_ATTACHMENT] }))

    expect(h.saveExchange).toHaveBeenCalledTimes(1)
    const [, , , , savedAttachments] = h.saveExchange.mock.calls[0]
    expect(savedAttachments).toEqual([IMAGE_ATTACHMENT])
  })

  it('degrades to an honest text mention (never fabricated content, never an image block) for a non-image document', async () => {
    const claude = fakeClaude('I see you attached a brief — what would you like me to focus on?')
    h.getClaudeCompletion.mockReturnValue(claude)

    await POST(req({ question: 'take a look at this', idea: 'x', companyId: 'brew-co', attachments: [DOC_ATTACHMENT] }))

    expect(h.fetchFileDownload).not.toHaveBeenCalled() // never fetches bytes for a non-image
    const callArgs = claude.create.mock.calls[0][0]
    const lastMessage: any = callArgs.messages[callArgs.messages.length - 1]
    expect(Array.isArray(lastMessage.content)).toBe(true)
    expect(lastMessage.content.every((b: any) => b.type === 'text')).toBe(true)
    const mention = lastMessage.content.find((b: any) => String(b.text).includes('brief.pdf'))
    expect(mention).toBeDefined()
  })

  it('degrades an image to a text mention (does not fail the request) when the presign/download fails', async () => {
    h.fetchFileDownload.mockResolvedValue(null) // presign resolution failed
    const claude = fakeClaude('Tell me more about the image.')
    h.getClaudeCompletion.mockReturnValue(claude)

    const res = await POST(req({ question: 'look at this', idea: 'x', companyId: 'brew-co', attachments: [IMAGE_ATTACHMENT] }))
    expect(res.status).toBe(200)
    const callArgs = claude.create.mock.calls[0][0]
    const lastMessage: any = callArgs.messages[callArgs.messages.length - 1]
    expect(lastMessage.content.some((b: any) => b.type === 'image')).toBe(false)
    expect(lastMessage.content.some((b: any) => b.type === 'text' && String(b.text).includes('storefront.png'))).toBe(true)
  })

  it('accepts a request with an attachment but no typed question (question is not required when an attachment is present)', async () => {
    h.fetchFileDownload.mockResolvedValue({ url: 'https://bucket.example.com/x.png', contentType: 'image/png' })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer } as any)))
    h.getClaudeCompletion.mockReturnValue(fakeClaude('Nice photo.'))

    const res = await POST(req({ question: '', idea: 'x', companyId: 'brew-co', attachments: [IMAGE_ATTACHMENT] }))
    expect(res.status).toBe(200)
  })

  it('still rejects a request with neither a question nor attachments', async () => {
    const res = await POST(req({ question: '', idea: 'x', companyId: 'brew-co' }))
    expect(res.status).toBe(400)
  })

  it('builds plain string content (unchanged pre-#741 shape) when there are no attachments', async () => {
    const claude = fakeClaude('Plain answer.')
    h.getClaudeCompletion.mockReturnValue(claude)
    await POST(req({ question: 'hello', idea: 'x', companyId: 'brew-co' }))
    const callArgs = claude.create.mock.calls[0][0]
    const lastMessage: any = callArgs.messages[callArgs.messages.length - 1]
    expect(typeof lastMessage.content).toBe('string')
    expect(lastMessage.content).toBe('hello')
    expect(h.fetchFileDownload).not.toHaveBeenCalled()
  })
})

describe('POST /api/build/ask — system prompt no longer denies chat upload (#741)', () => {
  it('does not tell Cody there is no in-chat file upload', async () => {
    const claude = fakeClaude('Answer.')
    h.getClaudeCompletion.mockReturnValue(claude)
    await POST(req({ question: 'can I send you a photo?', idea: 'x', companyId: 'brew-co' }))
    const system = String(claude.create.mock.calls[0][0].system)
    expect(system).not.toMatch(/no in-chat file upload/i)
    expect(system).toMatch(/real in-chat file upload/i)
  })
})
