/**
 * POST /api/build/artifact — artifact persistence (#927).
 *
 * Root blocker fixed: every real artifact generation (thesis, wedge, PRD,
 * dataModel, …) used to return `{view, content}` with NO call to
 * createDocument()/document-store.ts anywhere — confirmed via full-file
 * review before this change. The nightly loop's PRD-priority read path
 * (#901, lib/build/autonomous-loop.ts buildNightlySeedDescription) therefore
 * always fell back to a generic description, because there was never any
 * real persisted PRD to read. This suite covers the fix: an optional
 * `companyId` in the POST body resolves the SAME scope-key pattern
 * app/api/build/documents/route.ts already uses (deriveOwnerKey(session) +
 * chatScopeKey), and persists via document-store's upsertDocument() on
 * EVERY successful generation path — both the Bedrock/Anthropic primary
 * return and the AINative chat-completions fallback return.
 *
 * Properties under test:
 *   - a successful generation WITH a companyId persists via upsertDocument
 *     with the correct scope key and type, on BOTH the primary (Bedrock/
 *     Anthropic) and fallback (AINative) success paths
 *   - a successful generation with NO companyId still returns the artifact,
 *     never attempts to persist, never throws
 *   - a persistence failure (upsertDocument resolves null / throws) never
 *     blocks the artifact response reaching the founder — best-effort
 *   - regenerating (feedback) still persists via the overwrite-by-type path
 *     (upsertDocument, not a bare createDocument that would duplicate)
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  getClaudeCompletion: vi.fn(),
  messagesCreate: vi.fn(),
  ainativeCreate: vi.fn(),
  captureMessage: vi.fn(),
  auth: vi.fn(),
  upsertDocument: vi.fn(),
}))

vi.mock('@/lib/build/claude-completion', () => ({
  getClaudeCompletion: h.getClaudeCompletion,
}))

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: h.ainativeCreate } }
  },
}))

vi.mock('@sentry/nextjs', () => ({
  captureMessage: h.captureMessage,
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))

vi.mock('@/lib/build/document-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/build/document-store')>()
  return {
    ...actual,
    upsertDocument: h.upsertDocument,
  }
})

import { POST } from '@/app/api/build/artifact/route'

function req(body: unknown) {
  return { json: async () => body } as any
}

function claudeOk() {
  return {
    client: { messages: { create: h.messagesCreate } },
    provider: 'anthropic' as const,
    model: 'claude-sonnet-4-5-20250929',
  }
}

function anthropicText(text: string) {
  return { content: [{ type: 'text', text }] }
}

function ainativeText(text: string) {
  return { choices: [{ message: { content: text } }] }
}

const GOOD_PRD_JSON = JSON.stringify({
  title: 'Todo List App PRD', summary: 'A simple todo app.', requirements: [],
})

beforeEach(() => {
  h.getClaudeCompletion.mockReset()
  h.messagesCreate.mockReset()
  h.ainativeCreate.mockReset()
  h.captureMessage.mockReset()
  h.auth.mockReset().mockResolvedValue(null) // anonymous guest session
  h.upsertDocument.mockReset().mockResolvedValue({ id: 'd1', title: 'x', content: 'y', type: 'prd', kind: 'document', scopeKey: 's', createdAt: '2026-01-01T00:00:00Z' })
})

describe('POST /api/build/artifact — persistence (#927)', () => {
  it('persists the generated artifact via upsertDocument when companyId is present (primary Bedrock/Anthropic path)', async () => {
    h.getClaudeCompletion.mockReturnValue(claudeOk())
    h.messagesCreate.mockResolvedValueOnce(anthropicText(GOOD_PRD_JSON))

    const res = await POST(req({ view: 'prd', idea: 'A simple todo list app', track: 'app', companyId: 'acme-co' }))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.content.title).toBe('Todo List App PRD')
    expect(h.upsertDocument).toHaveBeenCalledTimes(1)
    const [scopeKey, input] = h.upsertDocument.mock.calls[0]
    // Anonymous/guest session → guest:anon owner key, composed with the company slug.
    expect(scopeKey).toBe('guest:anon::acme-co')
    expect(input.type).toBe('prd')
    expect(input.content).toContain('Todo List App PRD')
  })

  it('persists on the AINative fallback success path too (not just the primary provider)', async () => {
    h.getClaudeCompletion.mockReturnValue(null) // no Bedrock/Anthropic client configured
    h.ainativeCreate.mockResolvedValueOnce(ainativeText(GOOD_PRD_JSON))

    const res = await POST(req({ view: 'prd', idea: 'A simple todo list app', track: 'app', companyId: 'acme-co' }))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.provider).toBe('ainative')
    expect(h.upsertDocument).toHaveBeenCalledTimes(1)
    const [, input] = h.upsertDocument.mock.calls[0]
    expect(input.type).toBe('prd')
  })

  it('persists non-PRD views too — e.g. thesis — under their own DOC_TYPE', async () => {
    h.getClaudeCompletion.mockReturnValue(claudeOk())
    h.messagesCreate.mockResolvedValueOnce(anthropicText(JSON.stringify({ headline: 'x', sub: 'y' })))

    await POST(req({ view: 'thesis', idea: 'A simple todo list app', track: 'app', companyId: 'acme-co' }))

    expect(h.upsertDocument).toHaveBeenCalledTimes(1)
    const [, input] = h.upsertDocument.mock.calls[0]
    expect(input.type).toBe('thesis')
  })

  it('does NOT attempt to persist, and never throws, when companyId is absent (early intake, no project yet)', async () => {
    h.getClaudeCompletion.mockReturnValue(claudeOk())
    h.messagesCreate.mockResolvedValueOnce(anthropicText(GOOD_PRD_JSON))

    const res = await POST(req({ view: 'prd', idea: 'A simple todo list app', track: 'app' }))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.content.title).toBe('Todo List App PRD')
    expect(h.upsertDocument).not.toHaveBeenCalled()
  })

  it('still returns the artifact to the founder when persistence itself fails (upsertDocument resolves null)', async () => {
    h.getClaudeCompletion.mockReturnValue(claudeOk())
    h.messagesCreate.mockResolvedValueOnce(anthropicText(GOOD_PRD_JSON))
    h.upsertDocument.mockResolvedValueOnce(null)

    const res = await POST(req({ view: 'prd', idea: 'A simple todo list app', track: 'app', companyId: 'acme-co' }))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.content.title).toBe('Todo List App PRD')
  })

  it('still returns the artifact to the founder when upsertDocument THROWS (e.g. ZeroDB down) — never blocks the response', async () => {
    h.getClaudeCompletion.mockReturnValue(claudeOk())
    h.messagesCreate.mockResolvedValueOnce(anthropicText(GOOD_PRD_JSON))
    h.upsertDocument.mockRejectedValueOnce(new Error('ZeroDB unreachable'))

    const res = await POST(req({ view: 'prd', idea: 'A simple todo list app', track: 'app', companyId: 'acme-co' }))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.content.title).toBe('Todo List App PRD')
  })

  it('resolves the scope key from the real authenticated session email when signed in, not a guest key', async () => {
    h.auth.mockResolvedValue({ user: { email: 'Founder@Example.com', type: 'real' } })
    h.getClaudeCompletion.mockReturnValue(claudeOk())
    h.messagesCreate.mockResolvedValueOnce(anthropicText(GOOD_PRD_JSON))

    await POST(req({ view: 'prd', idea: 'A simple todo list app', track: 'app', companyId: 'AcmeCo' }))

    const [scopeKey] = h.upsertDocument.mock.calls[0]
    expect(scopeKey).toBe('founder@example.com::acmeco')
  })

  it('a regenerate (feedback present) still persists via the SAME overwrite-by-type path, not a duplicate-creating call', async () => {
    h.getClaudeCompletion.mockReturnValue(claudeOk())
    h.messagesCreate.mockResolvedValueOnce(anthropicText(GOOD_PRD_JSON))

    await POST(req({
      view: 'prd', idea: 'A simple todo list app', track: 'app', companyId: 'acme-co',
      feedback: 'Make it shorter',
    }))

    expect(h.upsertDocument).toHaveBeenCalledTimes(1)
  })

  it('never persists when generation fails on every provider (503) — nothing to persist', async () => {
    h.getClaudeCompletion.mockReturnValue(claudeOk())
    h.messagesCreate.mockRejectedValue(new Error('bedrock timeout'))
    h.ainativeCreate.mockRejectedValue(new Error('ainative down'))

    const res = await POST(req({ view: 'prd', idea: 'A simple todo list app', track: 'app', companyId: 'acme-co' }))

    expect(res.status).toBe(503)
    expect(h.upsertDocument).not.toHaveBeenCalled()
  })
})
