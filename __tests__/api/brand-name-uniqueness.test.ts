import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * POST /api/build/brand — name-uniqueness prevention at the source.
 *
 * Per explicit direction: a suffixed slug ("dwello" → "dwello-2") is NOT an
 * acceptable fix for a duplicate company name — the founder never types a
 * literal name at Intake (only an idea sentence), so every name from this
 * route is LLM-invented. The real fix is to check the registry BEFORE ever
 * returning a name, and re-prompt the model to invent something genuinely
 * different when the first proposal collides, rather than mechanically
 * suffixing a number onto an otherwise-good name.
 */

const h = vi.hoisted(() => ({
  getClaudeCompletion: vi.fn(),
  resolveApp: vi.fn(),
}))

vi.mock('@/lib/build/claude-completion', () => ({ getClaudeCompletion: h.getClaudeCompletion }))
vi.mock('@/lib/build/app-registry', () => ({ resolveApp: h.resolveApp }))

import { POST } from '@/app/api/build/brand/route'

function req(body: unknown) {
  return { json: async () => body } as any
}

/** A fake Claude client whose messages.create() returns a queued sequence of
 *  proposed names — one per call, in order — so tests can script exactly
 *  what the model "invents" across retries. */
function fakeClaude(names: (string | null)[]) {
  let i = 0
  const create = vi.fn(async (_args: { messages: Array<{ role: string; content: string }> }) => {
    const name = names[Math.min(i, names.length - 1)]
    i += 1
    if (name === null) throw new Error('model call failed')
    return { content: [{ type: 'text', text: JSON.stringify({ name, tagline: 'A real tagline', color: '#123456' }) }] }
  })
  return {
    client: { messages: { create } },
    provider: 'anthropic' as const,
    model: 'claude-sonnet-4-5',
    label: 'Claude Sonnet 4.5',
  }
}

describe('POST /api/build/brand — name uniqueness', () => {
  beforeEach(() => {
    h.getClaudeCompletion.mockReset()
    h.resolveApp.mockReset()
    vi.stubGlobal('fetch', vi.fn()) // the AINative-proxied tier is never reached in these tests
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns the first proposed name when it is genuinely free', async () => {
    h.getClaudeCompletion.mockReturnValue(fakeClaude(['Wisplane']))
    h.resolveApp.mockResolvedValue(null) // nothing registered under any slug
    const res = await POST(req({ idea: 'A tool for scheduling meetings', track: 'app' }))
    const json = await res.json()
    expect(json.name).toBe('Wisplane')
    expect(json.slug).toBe('wisplane')
  })

  it('re-prompts the model instead of suffixing when the first name collides', async () => {
    const claude = fakeClaude(['Dwello', 'Roostly'])
    h.getClaudeCompletion.mockReturnValue(claude)
    h.resolveApp.mockImplementation(async (slug: string) => (slug === 'dwello' ? { slug: 'dwello', chatId: 'someone-else' } : null))

    const res = await POST(req({ idea: 'A home-rental marketplace', track: 'company' }))
    const json = await res.json()

    expect(json.name).toBe('Roostly') // NOT "Dwello-2"
    expect(json.slug).toBe('roostly')
    expect(claude.client.messages.create).toHaveBeenCalledTimes(2)
  })

  it('tells the retry prompt exactly which name(s) are already taken', async () => {
    const claude = fakeClaude(['Dwello', 'Roostly'])
    h.getClaudeCompletion.mockReturnValue(claude)
    h.resolveApp.mockImplementation(async (slug: string) => (slug === 'dwello' ? { slug: 'dwello', chatId: 'x' } : null))

    await POST(req({ idea: 'A home-rental marketplace', track: 'company' }))

    const secondCallArgs = claude.client.messages.create.mock.calls[1][0]
    const userMessage = secondCallArgs.messages[0].content as string
    expect(userMessage).toContain('Dwello')
    expect(userMessage).toContain('ALREADY TAKEN')
  })

  it('keeps retrying across multiple consecutive collisions, accumulating every taken name', async () => {
    const claude = fakeClaude(['Dwello', 'Roostly', 'Nestwise'])
    h.getClaudeCompletion.mockReturnValue(claude)
    const taken = new Set(['dwello', 'roostly'])
    h.resolveApp.mockImplementation(async (slug: string) => (taken.has(slug) ? { slug, chatId: 'x' } : null))

    const res = await POST(req({ idea: 'A home-rental marketplace', track: 'company' }))
    const json = await res.json()

    expect(json.name).toBe('Nestwise')
    expect(claude.client.messages.create).toHaveBeenCalledTimes(3)
    const thirdCallArgs = claude.client.messages.create.mock.calls[2][0]
    const userMessage = thirdCallArgs.messages[0].content as string
    expect(userMessage).toContain('Dwello')
    expect(userMessage).toContain('Roostly')
  })

  it('never proposes the LLM-suggested collision name itself — real prevention, not cosmetic', async () => {
    const claude = fakeClaude(['Dwello', 'Dwello']) // model naively repeats itself
    h.getClaudeCompletion.mockReturnValue(claude)
    h.resolveApp.mockImplementation(async (slug: string) => (slug === 'dwello' ? { slug: 'dwello', chatId: 'x' } : null))

    const res = await POST(req({ idea: 'A home-rental marketplace', track: 'company' }))
    const json = await res.json()

    // Falls through every real attempt (all "Dwello"), lands on the
    // last-resort fallback derived from the idea — never returns "Dwello"
    // or a "Dwello-N" variant of the taken name.
    expect(json.name).not.toBe('Dwello')
    expect(json.slug).not.toContain('dwello')
  })

  it('falls back to a real, idea-derived name (never the taken one) when the model keeps failing outright', async () => {
    h.getClaudeCompletion.mockReturnValue(fakeClaude([null, null, null, null]))
    h.resolveApp.mockResolvedValue(null)
    const res = await POST(req({ idea: 'Build a scheduling assistant', track: 'app' }))
    const json = await res.json()
    expect(json.name).toBeTruthy()
    expect(json.slug).toBeTruthy()
  })

  it('never fails the request when the registry check itself errors — fail-open', async () => {
    h.getClaudeCompletion.mockReturnValue(fakeClaude(['Wisplane']))
    h.resolveApp.mockRejectedValue(new Error('zerodb timeout'))
    const res = await POST(req({ idea: 'A tool for scheduling meetings', track: 'app' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.name).toBe('Wisplane')
  })

  it('requires a real idea', async () => {
    const res = await POST(req({ idea: '', track: 'app' }))
    expect(res.status).toBe(400)
  })

  it('treats a reserved/infra subdomain the model proposes as taken and re-prompts', async () => {
    // "Insyteful" and "Builder" are reserved infra labels (RESERVED_SUBDOMAINS)
    // even though nothing is registered under them — the model must never be
    // allowed to hand out a real customer's own subdomain or an AINative infra
    // host as a brand-new company's slug.
    const claude = fakeClaude(['Builder', 'Roostly'])
    h.getClaudeCompletion.mockReturnValue(claude)
    h.resolveApp.mockResolvedValue(null) // registry has nothing — the reserved list is the only blocker

    const res = await POST(req({ idea: 'A home-rental marketplace', track: 'company' }))
    const json = await res.json()

    expect(json.name).toBe('Roostly') // NOT "Builder"
    expect(json.slug).not.toBe('builder')
    expect(claude.client.messages.create).toHaveBeenCalledTimes(2)
  })

  // #1268: proposeBrand()'s messages.create call had no AbortSignal/timeout
  // — a stalled upstream response hung the whole POST (retried up to
  // MAX_NAMING_ATTEMPTS times) indefinitely, same bug class as #1253/#1266.
  it('passes an AbortSignal to messages.create (#1268)', async () => {
    const claude = fakeClaude(['Wisplane'])
    h.getClaudeCompletion.mockReturnValue(claude)
    h.resolveApp.mockResolvedValue(null)

    await POST(req({ idea: 'A tool for scheduling meetings', track: 'app' }))
    expect(claude.client.messages.create).toHaveBeenCalledTimes(1)
    const [, options] = claude.client.messages.create.mock.calls[0] as unknown as [unknown, { signal?: AbortSignal }]
    expect(options?.signal).toBeInstanceOf(AbortSignal)
  })

  it('a stalled/aborted call is caught — falls back to the idea-derived name, never hangs (#1268)', async () => {
    const create = vi.fn().mockImplementation((_args: unknown, options: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('This operation was aborted')))
    }))
    h.getClaudeCompletion.mockReturnValue({
      client: { messages: { create } }, provider: 'anthropic' as const, model: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5',
    })
    h.resolveApp.mockResolvedValue(null)

    const pending = POST(req({ idea: 'Build a scheduling assistant', track: 'app' }))
    // proposeBrand() returning null (both tiers failed) breaks the retry
    // loop immediately — one stalled call is enough to reach the
    // idea-derived fallback, same as the existing "keeps failing outright"
    // case above.
    await vi.waitFor(() => expect(create).toHaveBeenCalled())
    create.mock.calls[0][1]?.signal?.dispatchEvent(new Event('abort'))
    const res = await pending
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.name).toBeTruthy()
    expect(json.slug).toBeTruthy()
  })
})
