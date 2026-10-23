import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * #1202 (Coverage Phase 2, pass 4) — app/api/chat/route.ts had zero
 * route-level coverage. This is the smaller sibling of chat-ws/route.ts
 * (same architecture: auth -> prompt enhancement pipeline -> LLM call ->
 * preview store), so it's the tractable target this pass while chat-ws
 * stays deferred (40+ module-scope imports, live OpenAI/Bedrock client
 * construction on import — see chat-ws-model-tier-naming.test.ts's note on
 * why that file is tested via source-text assertions instead).
 *
 * Everything the route touches is mocked at the module boundary: auth,
 * preview store, prompt-builder/design-tokens/rlhf services, the OpenAI
 * SDK itself, template matcher/customizer services, and the drizzle `db`
 * the template-matching branch reaches for. No real network/DB/auth call
 * happens in this file.
 */

const authMock = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('@/app/(auth)/auth', () => ({ auth: authMock.auth }))

const previewStore = vi.hoisted(() => ({
  storePreview: vi.fn(),
  updatePreviewPartial: vi.fn(),
  getChatDataDurable: vi.fn(),
}))
vi.mock('@/lib/preview-store', () => previewStore)

vi.mock('@/lib/component-verifier', () => ({
  verifyAndEnhancePrompt: vi.fn((message: string) => ({ enhancedMessage: message, verifiedComponents: [] })),
}))

vi.mock('@/lib/professional-prompt', () => ({
  PROFESSIONAL_SYSTEM_PROMPT: 'base-system-prompt',
}))

vi.mock('@/lib/build/primitive-catalog', () => ({
  codegenCompositionBlock: vi.fn(() => 'composition-block'),
}))

vi.mock('@/lib/mock-data-generator', () => ({
  enhancePromptWithMockData: vi.fn((p: string) => p),
}))

const rlhfService = vi.hoisted(() => ({
  logGeneration: vi.fn().mockResolvedValue('log-id'),
  getActivePromptVersion: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/services/rlhf.service', () => rlhfService)

const promptBuilder = vi.hoisted(() => ({
  buildEnhancedPrompt: vi.fn().mockResolvedValue({
    enhancedPrompt: 'enhanced prompt text',
    systemPrompt: 'enhanced system prompt',
    metadata: {
      originalLanguage: 'en',
      wasTranslated: false,
      detectedUIType: 'dashboard',
      uiTypeConfidence: 0.9,
      examplesCount: 2,
      examplesMethod: 'semantic',
      componentDocsInjected: 1,
      tokenBudget: { breakdown: '1000/2000' },
      wasTruncated: false,
      processingTimeMs: 5,
    },
  }),
}))
vi.mock('@/lib/services/prompt-builder.service', () => promptBuilder)

const designTokensService = vi.hoisted(() => ({
  getActiveDesignTokens: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/services/design-tokens.service', () => designTokensService)

vi.mock('@/lib/build/env-keys', () => ({
  getAinativeApiKey: vi.fn(() => 'test-ainative-key'),
}))

const templateMatcherService = vi.hoisted(() => ({
  matchTemplate: vi.fn().mockResolvedValue({
    templateCategory: null,
    confidence: 0,
    matchType: 'none',
    semanticDegraded: false,
  }),
}))
vi.mock('@/lib/services/template-matcher.service', () => ({
  getTemplateMatcherService: vi.fn(() => templateMatcherService),
}))

const templateCustomizerService = vi.hoisted(() => ({
  customize: vi.fn().mockResolvedValue({
    success: false,
    customizedCode: null,
    placeholdersReplaced: [],
    placeholdersNotFound: [],
  }),
}))
vi.mock('@/lib/services/template-customizer.service', () => ({
  getTemplateCustomizerService: vi.fn(() => templateCustomizerService),
}))

const dbMock = vi.hoisted(() => {
  const chain: any = {
    select: vi.fn(() => chain),
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve([])),
    update: vi.fn(() => chain),
    set: vi.fn(() => chain),
  }
  return { db: chain }
})
vi.mock('@/lib/db', () => dbMock)

vi.mock('@/lib/db/schema', () => ({
  templates: { category: 'category', id: 'id', usage_count: 'usage_count' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ a, b })),
}))

// The route constructs an OpenAI client at module scope. Mock the SDK so
// import time never touches real credentials/network, and so we control
// what `chat.completions.create` resolves/streams per test.
const openaiCreate = vi.hoisted(() => vi.fn())
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: openaiCreate } },
  })),
}))

function jsonRequest(body: unknown) {
  return new NextRequest('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function malformedRequest() {
  return new NextRequest('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not valid json',
  })
}

async function readSSE(res: Response): Promise<string> {
  const reader = (res.body as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  let text = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value)
  }
  return text
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.auth.mockResolvedValue(null)
  rlhfService.logGeneration.mockResolvedValue('log-id')
  rlhfService.getActivePromptVersion.mockResolvedValue(null)
  designTokensService.getActiveDesignTokens.mockResolvedValue(null)
  templateMatcherService.matchTemplate.mockResolvedValue({
    templateCategory: null,
    confidence: 0,
    matchType: 'none',
    semanticDegraded: false,
  })
  templateCustomizerService.customize.mockResolvedValue({
    success: false,
    customizedCode: null,
    placeholdersReplaced: [],
    placeholdersNotFound: [],
  })
  dbMock.db.limit.mockResolvedValue([])
  promptBuilder.buildEnhancedPrompt.mockResolvedValue({
    enhancedPrompt: 'enhanced prompt text',
    systemPrompt: 'enhanced system prompt',
    metadata: {
      originalLanguage: 'en',
      wasTranslated: false,
      detectedUIType: 'dashboard',
      uiTypeConfidence: 0.9,
      examplesCount: 2,
      examplesMethod: 'semantic',
      componentDocsInjected: 1,
      tokenBudget: { breakdown: '1000/2000' },
      wasTruncated: false,
      processingTimeMs: 5,
    },
  })
  openaiCreate.mockReset()
})

describe('#1202 POST /api/chat', () => {
  it('returns 400 when message is missing', async () => {
    const { POST } = await import('@/app/api/chat/route')
    const res = await POST(jsonRequest({}))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toEqual({ error: 'Message is required' })
  })

  it('returns 500 when the request body is malformed JSON', async () => {
    const { POST } = await import('@/app/api/chat/route')
    const res = await POST(malformedRequest())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ error: 'Failed to process request' })
  })

  it('non-streaming: returns assistant message + demo preview URL for an authenticated user', async () => {
    authMock.auth.mockResolvedValue({ user: { id: 'user-42' } })
    openaiCreate.mockResolvedValue({
      choices: [{ message: { content: 'generated code here' } }],
    })

    const { POST } = await import('@/app/api/chat/route')
    const res = await POST(jsonRequest({ message: 'build me a dashboard' }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.demo).toMatch(/^\/preview\//)
    expect(body.messages[0].role).toBe('assistant')
    expect(body.messages[0].content).toBe('generated code here')
    expect(previewStore.storePreview).toHaveBeenCalledWith(
      body.id,
      'generated code here',
      'build me a dashboard',
    )
    expect(rlhfService.logGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-42', prompt: 'build me a dashboard' }),
    )
  })

  it('non-streaming: skips logGeneration for anonymous users', async () => {
    authMock.auth.mockResolvedValue(null)
    openaiCreate.mockResolvedValue({
      choices: [{ message: { content: 'anon generated code' } }],
    })

    const { POST } = await import('@/app/api/chat/route')
    const res = await POST(jsonRequest({ message: 'anonymous idea' }))

    expect(res.status).toBe(200)
    expect(rlhfService.logGeneration).not.toHaveBeenCalled()
  })

  it('non-streaming: no demo URL when the model returns empty content', async () => {
    openaiCreate.mockResolvedValue({ choices: [{ message: { content: '' } }] })

    const { POST } = await import('@/app/api/chat/route')
    const res = await POST(jsonRequest({ message: 'build something' }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.demo).toBeNull()
    expect(previewStore.storePreview).not.toHaveBeenCalled()
  })

  it('reuses a continued chat: pulls previous messages from durable preview store', async () => {
    previewStore.getChatDataDurable.mockResolvedValue({
      messages: [{ role: 'user', content: 'earlier message' }],
    })
    openaiCreate.mockResolvedValue({ choices: [{ message: { content: 'follow-up code' } }] })

    const { POST } = await import('@/app/api/chat/route')
    const res = await POST(jsonRequest({ message: 'continue', chatId: 'chat-abc' }))

    expect(res.status).toBe(200)
    expect(previewStore.getChatDataDurable).toHaveBeenCalledWith('chat-abc')
    const sentMessages = openaiCreate.mock.calls[0][0].messages
    expect(sentMessages.some((m: any) => m.content === 'earlier message')).toBe(true)
  })

  it('falls back to the default prompt when getActivePromptVersion throws', async () => {
    rlhfService.getActivePromptVersion.mockRejectedValue(new Error('db down'))
    openaiCreate.mockResolvedValue({ choices: [{ message: { content: 'ok' } }] })

    const { POST } = await import('@/app/api/chat/route')
    const res = await POST(jsonRequest({ message: 'build it' }))

    expect(res.status).toBe(200)
  })

  it('uses the active A/B prompt version when available', async () => {
    rlhfService.getActivePromptVersion.mockResolvedValue({
      id: 'v2',
      content: 'ab-test-system-prompt',
      version: 'v2',
    })
    openaiCreate.mockResolvedValue({ choices: [{ message: { content: 'ok' } }] })

    const { POST } = await import('@/app/api/chat/route')
    const res = await POST(jsonRequest({ message: 'build it' }))

    expect(res.status).toBe(200)
    expect(rlhfService.logGeneration).not.toHaveBeenCalled() // anonymous by default
  })

  it('swallows design-token lookup failures for authenticated users and still generates', async () => {
    authMock.auth.mockResolvedValue({ user: { id: 'user-7' } })
    designTokensService.getActiveDesignTokens.mockRejectedValue(new Error('tokens unavailable'))
    openaiCreate.mockResolvedValue({ choices: [{ message: { content: 'ok' } }] })

    const { POST } = await import('@/app/api/chat/route')
    const res = await POST(jsonRequest({ message: 'build it' }))

    expect(res.status).toBe(200)
  })

  it('swallows template-matching failures and proceeds with normal generation', async () => {
    templateMatcherService.matchTemplate.mockRejectedValue(new Error('matcher down'))
    openaiCreate.mockResolvedValue({ choices: [{ message: { content: 'ok' } }] })

    const { POST } = await import('@/app/api/chat/route')
    const res = await POST(jsonRequest({ message: 'build it' }))

    expect(res.status).toBe(200)
  })

  it('matches + customizes a high-confidence template and increments its usage count', async () => {
    templateMatcherService.matchTemplate.mockResolvedValue({
      templateCategory: 'dashboard',
      confidence: 0.95,
      matchType: 'semantic',
      semanticDegraded: false,
    })
    dbMock.db.limit.mockResolvedValue([
      { id: 'tmpl-1', name: 'Dashboard Template', category: 'dashboard', code: 'base code', usage_count: 3, metadata: { placeholders: {} } },
    ])
    templateCustomizerService.customize.mockResolvedValue({
      success: true,
      customizedCode: 'customized template code',
      placeholdersReplaced: ['title'],
      placeholdersNotFound: [],
    })
    openaiCreate.mockResolvedValue({ choices: [{ message: { content: 'ok' } }] })

    const { POST } = await import('@/app/api/chat/route')
    const res = await POST(jsonRequest({ message: 'build a dashboard', streaming: false }))

    // Non-streaming path still calls the LLM (customizedTemplateCode only
    // short-circuits generation in the streaming branch) — assert the
    // customization + usage-count-increment side effects happened.
    expect(templateCustomizerService.customize).toHaveBeenCalled()
    expect(dbMock.db.set).toHaveBeenCalledWith({ usage_count: 4 })
    expect(res.status).toBe(200)
  })

  it('a validated company role narrows primitive composition', async () => {
    const { codegenCompositionBlock } = await import('@/lib/build/primitive-catalog')
    openaiCreate.mockResolvedValue({ choices: [{ message: { content: 'ok' } }] })

    const { POST } = await import('@/app/api/chat/route')
    await POST(jsonRequest({ message: 'build it', role: 'sales' }))

    expect(codegenCompositionBlock).toHaveBeenCalledWith('build it', 'company', 'sales')
  })

  it('an invalid company role is dropped rather than passed through', async () => {
    const { codegenCompositionBlock } = await import('@/lib/build/primitive-catalog')
    openaiCreate.mockResolvedValue({ choices: [{ message: { content: 'ok' } }] })

    const { POST } = await import('@/app/api/chat/route')
    await POST(jsonRequest({ message: 'build it', role: 'not-a-real-role' }))

    expect(codegenCompositionBlock).toHaveBeenCalledWith('build it', 'company', undefined)
  })

  it('streaming: emits SSE chunks and a final done event from the LLM stream', async () => {
    async function* fakeStream() {
      yield { choices: [{ delta: { content: 'Hello ' } }] }
      yield { choices: [{ delta: { content: 'world' } }] }
    }
    openaiCreate.mockResolvedValue(fakeStream())

    const { POST } = await import('@/app/api/chat/route')
    const res = await POST(jsonRequest({ message: 'stream this', streaming: true }))

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')

    const text = await readSSE(res)
    expect(text).toContain('"content":"Hello "')
    expect(text).toContain('"content":"world"')
    expect(text).toContain('"done":true')
    expect(previewStore.storePreview).toHaveBeenCalledWith(
      expect.any(String),
      'Hello world',
      'stream this',
    )
  })

  it('streaming: logs generation for authenticated users once the stream completes', async () => {
    authMock.auth.mockResolvedValue({ user: { id: 'user-9' } })
    async function* fakeStream() {
      yield { choices: [{ delta: { content: 'done code' } }] }
    }
    openaiCreate.mockResolvedValue(fakeStream())

    const { POST } = await import('@/app/api/chat/route')
    const res = await POST(jsonRequest({ message: 'stream for user', streaming: true }))
    await readSSE(res)

    expect(rlhfService.logGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-9', generatedCode: 'done code', model: 'kimi-k2' }),
    )
  })

  it('streaming: a pre-customized template short-circuits the LLM and streams the template instead', async () => {
    templateMatcherService.matchTemplate.mockResolvedValue({
      templateCategory: 'landing',
      confidence: 0.99,
      matchType: 'semantic',
      semanticDegraded: false,
    })
    dbMock.db.limit.mockResolvedValue([
      { id: 'tmpl-2', name: 'Landing Template', category: 'landing', code: 'landing code', usage_count: 0, metadata: { placeholders: {} } },
    ])
    templateCustomizerService.customize.mockResolvedValue({
      success: true,
      customizedCode: 'XY',
      placeholdersReplaced: [],
      placeholdersNotFound: [],
    })

    const { POST } = await import('@/app/api/chat/route')
    const res = await POST(jsonRequest({ message: 'build a landing page', streaming: true }))

    expect(res.status).toBe(200)
    const text = await readSSE(res)
    expect(text).toContain('"usingTemplate":true')
    expect(openaiCreate).not.toHaveBeenCalled()
    expect(previewStore.storePreview).toHaveBeenCalledWith(expect.any(String), 'XY', 'build a landing page')
  })

  it('streaming: surfaces a degraded semantic-match flag to the client', async () => {
    templateMatcherService.matchTemplate.mockResolvedValue({
      templateCategory: null,
      confidence: 0,
      matchType: 'none',
      semanticDegraded: true,
    })
    async function* fakeStream() {
      yield { choices: [{ delta: { content: 'x' } }] }
    }
    openaiCreate.mockResolvedValue(fakeStream())

    const { POST } = await import('@/app/api/chat/route')
    const res = await POST(jsonRequest({ message: 'build it', streaming: true }))
    const text = await readSSE(res)

    expect(text).toContain('"templateMatchDegraded":true')
  })

  it('returns 500 when the LLM call itself throws', async () => {
    openaiCreate.mockRejectedValue(new Error('upstream LLM failure'))

    const { POST } = await import('@/app/api/chat/route')
    const res = await POST(jsonRequest({ message: 'build it' }))

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ error: 'Failed to process request' })
  })
})
