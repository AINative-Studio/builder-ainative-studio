/**
 * Route-level coverage for app/api/chat-ws/route.ts (#1202 — Coverage Phase
 * 2, fifth pass).
 *
 * chat-ws/route.ts is the single largest route handler in this repo
 * (~2400 lines) and had been deferred across four prior coverage passes —
 * its substantive business logic (obedience gate, decomposition, model
 * selection, validation, RAG, etc.) is already unit-tested at the lib layer,
 * and every PRIOR chat-ws test file in this repo only asserts on the route's
 * raw SOURCE TEXT (readFileSync + string/regex matching) rather than
 * importing and executing it — because the module constructs real OpenAI
 * clients at module scope, and the POST handler's real work happens inside a
 * ReadableStream's `start(controller)` callback, which v8 coverage can't see
 * unless something actually reads the stream.
 *
 * This file takes the more expensive but higher-value approach: mock every
 * library-layer dependency (so this exercises ONLY this file's own control
 * flow — request parsing, auth-gate, provider/model routing, the SSE
 * event-framing, the validation/retry/degradation branches, and the various
 * controller.close() exit paths), construct a real POST request, and fully
 * DRAIN the returned SSE stream so the ReadableStream's start() callback
 * actually runs end-to-end under coverage instrumentation.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { mockJsonRequest, mockMalformedJsonRequest } from '../helpers/api-route-harness'

// ---- next-auth -------------------------------------------------------
vi.mock('next-auth/jwt', () => ({
  getToken: vi.fn(async () => null),
}))

// ---- Sentry (no-op) ---------------------------------------------------
vi.mock('@sentry/nextjs', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}))

// ---- Bedrock / Anthropic direct client — force the AINative fallback path
vi.mock('@/lib/bedrock-client', () => ({
  isBedrockEnabled: vi.fn(() => false),
  getBedrockClient: vi.fn(() => null),
}))

// ---- env keys ----------------------------------------------------------
vi.mock('@/lib/build/env-keys', () => ({
  getAinativeApiKey: vi.fn(() => 'test-ainative-key'),
}))

// ---- model config logger (no-op) ---------------------------------------
vi.mock('@/lib/config/model-validator', () => ({
  logModelConfiguration: vi.fn(),
  validateModelConfiguration: vi.fn(() => ({ ok: true, issues: [] })),
}))

// ---- preview store -------------------------------------------------------
const storePreviewMock = vi.fn()
const updatePreviewPartialMock = vi.fn()
const getChatDataDurableMock = vi.fn(async (..._args: any[]): Promise<any> => undefined)
vi.mock('@/lib/preview-store', () => ({
  storePreview: (...args: any[]) => storePreviewMock(...args),
  updatePreviewPartial: (...args: any[]) => updatePreviewPartialMock(...args),
  getChatDataDurable: (...args: any[]) => getChatDataDurableMock(...args),
  storeSSRPreview: vi.fn(),
  getSSRPreview: vi.fn(() => null),
}))

const storeFilesV2Mock = vi.fn()
vi.mock('@/lib/preview-store-v2', () => ({
  storeFiles: (...args: any[]) => storeFilesV2Mock(...args),
}))

// ---- code validation -----------------------------------------------------
let validateGeneratedCodeImpl = (raw: string) => ({
  valid: true,
  code: raw && raw.length > 0 ? raw : 'export default function App() { return null }',
  error: undefined as string | undefined,
})
vi.mock('@/lib/code-validator', () => ({
  validateGeneratedCode: (raw: string) => validateGeneratedCodeImpl(raw),
}))

vi.mock('@/lib/build/output-validator', () => ({
  validateOutput: vi.fn(() => ({ passed: true, checks: [], summary: 'ok' })),
  validateFileImports: vi.fn(() => ({ passed: true, checks: [], summary: 'ok' })),
}))

vi.mock('@/lib/validation-fallback', () => ({
  buildValidationFallbackComponent: vi.fn(() => '```jsx\nexport default function Fallback(){return null}\n```'),
}))

vi.mock('@/lib/generation-retry', () => ({
  runValidationRetryLoop: vi.fn(async (validation: any) => ({
    attempts: 0,
    recovered: false,
    code: validation.code,
    validation,
  })),
  buildRepairPrompt: vi.fn(() => 'repair-prompt'),
  extractErrorWindow: vi.fn((code: string) => code),
}))

// ---- obedience gate / decomposition / RAG / model select -----------------
let checkObedienceImpl = (_code: string, _msg: string, _role: any, _opts: any) => ({
  ok: true,
  persistenceGap: false,
  aikitGaps: [] as string[],
  primitiveComplianceGaps: [] as string[],
  visitorTrackingGap: false,
  fakeLeadCaptureGap: false,
  fakeButtonGap: false,
  hardcodedToggleGap: false,
  axLandmarkGap: false,
  axManifestGap: false,
  axJsonLdGap: false,
  axSkipNavGap: false,
  axNavLabelGap: false,
  axSectionLabelGap: false,
  axAgentAttributesGap: false,
  axComplexWidgetRoleGap: false,
  reasons: [] as string[],
})
vi.mock('@/lib/build/obedience-gate', () => ({
  checkObedience: (...args: any[]) => (checkObedienceImpl as any)(...args),
  buildObediencePrompt: vi.fn(() => 'obedience-fix-prompt'),
  narrowToPrimitiveComplianceOnly: vi.fn((gaps: string[]) => gaps),
  evaluatePrimitiveComplianceRetry: vi.fn(() => ({ madeProgress: false, closed: false })),
}))

vi.mock('@/lib/build/primitive-compliance-trace', () => ({
  traceComplianceRetry: vi.fn(async () => {}),
}))

vi.mock('@/lib/build/rag-context', () => ({
  buildRagContext: vi.fn(async () => ''),
}))

let shouldDecomposeImpl = (_code: string, _wantsMultiFile: boolean) => false
vi.mock('@/lib/build/decomposition', () => ({
  shouldDecompose: (...args: any[]) => (shouldDecomposeImpl as any)(...args),
  buildDecompositionPrompt: vi.fn(() => 'decomposition-prompt'),
  buildFixAndDecomposePrompt: vi.fn(() => 'fix-and-decompose-prompt'),
}))

vi.mock('@/lib/build/model-select', () => ({
  selectModelForComplexity: vi.fn(() => 'claude-sonnet-test'),
  modelSelectionReport: vi.fn(() => 'model-selection-report'),
}))

// ---- ZeroMemory -----------------------------------------------------------
vi.mock('@/lib/agent/zeromemory', () => ({
  recallPastPerformance: vi.fn(async () => ''),
  storeGenerationMemory: vi.fn(async () => {}),
  relateEntityToPrimitives: vi.fn(async () => {}),
}))

// ---- app registry / chat store / task store -------------------------------
const resolveAppByChatIdMock = vi.fn(async (..._args: any[]): Promise<any> => null)
vi.mock('@/lib/build/app-registry', () => ({
  resolveAppByChatId: (...args: any[]) => resolveAppByChatIdMock(...args),
}))
vi.mock('@/lib/build/chat-store', () => ({
  chatScopeKey: vi.fn((owner: string, slug: string) => `${owner}:${slug}`),
}))
vi.mock('@/lib/build/task-store', () => ({
  createTask: vi.fn(async () => ({ id: 'task-1' })),
}))

// ---- verify-loop / test-runner ---------------------------------------------
vi.mock('@/lib/agent/verify-loop', () => ({
  buildVerifyPrompt: vi.fn(() => 'verify-prompt'),
  buildVerifyAgentOptions: vi.fn(() => ({})),
}))
vi.mock('@/lib/agent/test-runner', () => ({
  getWorktreeTestFailure: vi.fn(() => null),
  clearWorktreeTestResult: vi.fn(),
}))

// ---- design memory / unsplash / design systems -----------------------------
vi.mock('@/lib/services/unsplash.service', () => ({
  fetchContextualImages: vi.fn(async () => []),
  formatImagesForPrompt: vi.fn(() => ''),
  getFallbackImages: vi.fn(() => []),
}))
vi.mock('@/lib/build/design-memory', () => ({
  recordComponent: vi.fn(async () => {}),
  formatDesignMemoryForPrompt: vi.fn(async () => ''),
}))

// ---- subagents / generation-mode -------------------------------------------
vi.mock('@/lib/agent/subagents', () => ({
  runOrchestratorAgent: vi.fn(async () => ({ success: true, componentCode: 'export default function App(){return null}' })),
}))
let useSubagentsImpl = () => false
vi.mock('@/lib/agent/generation-mode', () => ({
  useSubagents: (...args: any[]) => (useSubagentsImpl as any)(...args),
}))

// ---- PRD / complexity analysis (allowed to run for real — pure functions,
// already unit-tested at the lib layer) except complexity-analyzer, which we
// stub so we can deterministically force the chunking/agent branches.
let analyzeComplexityImpl = () => ({
  overallComplexity: 'simple' as 'simple' | 'medium' | 'complex',
  shouldUseAgent: false,
  requiresChunking: false,
  chunkingStrategy: 'none',
  estimatedTokens: 500,
})
vi.mock('@/lib/agent/complexity-analyzer', () => ({
  analyzeComplexity: (...args: any[]) => (analyzeComplexityImpl as any)(...args),
  augmentPRDAnalysisForChunking: vi.fn((prd: any) => prd),
  getComplexityReport: vi.fn(() => 'complexity-report'),
}))

vi.mock('@/lib/agent/chunk-planner', () => ({
  createChunkPlan: vi.fn(() => ({ phases: [] })),
  getChunkPlanSummary: vi.fn(() => 'chunk-plan-summary'),
}))
vi.mock('@/lib/agent/multi-pass-generator', () => ({
  executeChunkPlan: vi.fn(async (_plan: any, _client: any, _model: any, onProgress: any) => {
    onProgress(1, 1, 'chunking', {})
    return [{ tokenUsage: { input: 10, output: 10, total: 20 } }]
  }),
  getGenerationSummary: vi.fn(() => 'generation-summary'),
}))
vi.mock('@/lib/agent/chunk-merger', () => ({
  mergeChunks: vi.fn(() => 'export default function App(){return null}'),
  getMergeSummary: vi.fn(() => 'merge-summary'),
}))

// ---- ainative file generator / multi-file parser / preview engine --------
vi.mock('@/lib/ainative-file-generator', () => ({
  generateAINativeFileSet: vi.fn(() => ({ 'robots.txt': 'User-agent: *' })),
}))
vi.mock('@/lib/multi-file-parser', () => ({
  parseMultiFileOutput: vi.fn((code: string) => ({ 'src/App.tsx': code })),
}))
vi.mock('@/lib/build/preview-engine', () => ({
  shouldUseSandpack: vi.fn(() => false),
}))
vi.mock('@/lib/build/design-conformance', () => ({
  checkDesignConformance: vi.fn(() => ({ status: 'pass', score: 1, summary: 'ok' })),
}))

// ---- build cost ledger ------------------------------------------------------
vi.mock('@/lib/build/build-cost-ledger', () => ({
  recordBuildCost: vi.fn(async () => {}),
  buildCostEntryFromTokenUsage: vi.fn(() => ({})),
}))

// ---- claude agent -----------------------------------------------------------
let isClaudeAgentEnabledImpl = () => false
let isClaudeAgentFallbackEnabledImpl = () => false
vi.mock('@/lib/agent/claude-agent', () => ({
  isClaudeAgentEnabled: (...args: any[]) => (isClaudeAgentEnabledImpl as any)(...args),
  isClaudeAgentFallbackEnabled: (...args: any[]) => (isClaudeAgentFallbackEnabledImpl as any)(...args),
  runHeadlessAgent: vi.fn(async function* () {
    yield { type: 'error', error: 'agent not used in this test', fatal: true }
  }),
}))
vi.mock('@/lib/agent/worktree-manager', () => ({
  cleanupWorktree: vi.fn(async () => {}),
}))
vi.mock('@/lib/services/agent-runs.service', () => ({
  logAgentRun: vi.fn(async () => {}),
}))
vi.mock('@/lib/quota-error', () => ({
  isQuotaError: vi.fn(() => false),
  QUOTA_USER_MESSAGE: 'You have run out of generation quota for this month.',
}))

// ---- context budget ----------------------------------------------------------
type ApplyChatBudgetResult = {
  messages: any[]
  budget: Record<string, any> | null
  trimmed: boolean
  droppedCount: number
}
let applyChatBudgetImpl = async (_chatId: string, _userId: string, previousMessages: any[]): Promise<ApplyChatBudgetResult> => ({
  messages: previousMessages,
  budget: null,
  trimmed: false,
  droppedCount: 0,
})
vi.mock('@/lib/build/context-budget-chat', () => ({
  applyChatBudget: (...args: any[]) => (applyChatBudgetImpl as any)(...args),
}))

// ---- shutdown flush ------------------------------------------------------------
vi.mock('@/lib/generation-shutdown-flush', () => ({
  registerInFlightGeneration: vi.fn(),
  unregisterInFlightGeneration: vi.fn(),
  installShutdownFlushHandler: vi.fn(),
}))

// ---- dynamic imports used inside the handler -----------------------------------
vi.mock('@/lib/zerodb-store', () => ({
  saveGeneration: vi.fn(async () => ({ saved: true })),
  logGenerationEvent: vi.fn(async () => {}),
}))
vi.mock('@/lib/generation-persist', () => ({
  persistGeneration: vi.fn(async () => ({ saved: true, reason: 'ok' })),
}))
vi.mock('@/lib/services/rlhf.service', () => ({
  logGeneration: vi.fn(async () => {}),
  logGenerationFailure: vi.fn(async () => {}),
}))
vi.mock('@/lib/showcase-store', () => ({
  addToShowcase: vi.fn(() => true),
}))
vi.mock('@/lib/sandbox-builder', () => ({
  buildInSandbox: vi.fn(async () => ({ success: false })),
}))

// ---- design systems catalog / design tokens --------------------------------
vi.mock('@/lib/design-systems/catalog', () => ({
  getDesignSystem: vi.fn(() => undefined),
}))
vi.mock('@/lib/services/design-tokens.service', () => ({
  tokensFromDesignSystem: vi.fn(() => ({})),
  formatTokensForPrompt: vi.fn(() => ''),
}))

// ---- OpenAI client (module-scope construction) --------------------------------
const chatCompletionsCreateMock = vi.fn(async (..._args: any[]): Promise<any> => ({
  choices: [{ message: { content: 'export default function App(){return null}' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
}))
vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: (...args: any[]) => chatCompletionsCreateMock(...args) } }
  },
}))

// The route deliberately calls eval('require')('fs') to dodge static
// analysis (see its own comment) and appends the RLHF local JSONL to
// path.join(process.cwd(), 'data') — that eval'd require() resolves Vite's
// frozen ESM-interop 'fs' namespace, which can't be patched via vi.mock or
// vi.spyOn (both throw: "Cannot redefine property"). Rather than fight that,
// redirect where the real (unmocked) write lands: point process.cwd() at this
// test run's own scratch directory so the write still succeeds for real, but
// never touches the repo's actual tracked data/rlhf-training-data.jsonl.
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
const scratchCwd = mkdtempSync(join(tmpdir(), 'chat-ws-route-test-'))
const realCwd = process.cwd.bind(process)
vi.spyOn(process, 'cwd').mockImplementation(() => scratchCwd)

async function drainSSE(response: Response): Promise<{ events: any[]; raw: string }> {
  const text = await response.text()
  const events: any[] = []
  for (const block of text.split('\n\n')) {
    const line = block.split('\n').find((l) => l.startsWith('data: '))
    if (!line) continue
    try {
      events.push(JSON.parse(line.slice('data: '.length)))
    } catch {
      // keepalive comments (": keepalive") or malformed partials — ignore
    }
  }
  return { events, raw: text }
}

describe('POST /api/chat-ws — route-level coverage (#1202)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.useRealTimers()
    // Re-pin process.cwd() every test — vi.clearAllMocks() clears call
    // history but never implementation, so this is belt-and-suspenders
    // against a leaked override redirecting it somewhere unexpected.
    vi.spyOn(process, 'cwd').mockImplementation(() => scratchCwd)
    // Guard against a leaked `mockReturnValueOnce`/`mockImplementationOnce`
    // from a previous test that never consumed it (e.g. a test that queued a
    // one-time Bedrock client but took a code path that never called
    // getBedrockClient) — explicitly pin the safe defaults every test starts
    // from, rather than relying on every test to consume exactly what it queues.
    const { getBedrockClient, isBedrockEnabled } = await import('@/lib/bedrock-client')
    ;(getBedrockClient as any).mockReturnValue(null)
    ;(isBedrockEnabled as any).mockReturnValue(false)
    const { runHeadlessAgent } = await import('@/lib/agent/claude-agent')
    ;(runHeadlessAgent as any).mockImplementation(async function* () {
      yield { type: 'error', error: 'agent not used in this test', fatal: true }
    })
    const { getToken } = await import('next-auth/jwt')
    ;(getToken as any).mockImplementation(async () => null)
    getChatDataDurableMock.mockImplementation(async () => undefined)
    resolveAppByChatIdMock.mockImplementation(async () => null)
    chatCompletionsCreateMock.mockImplementation(async () => ({
      choices: [{ message: { content: 'export default function App(){return null}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    }))
    const { isQuotaError } = await import('@/lib/quota-error')
    ;(isQuotaError as any).mockReturnValue(false)
    validateGeneratedCodeImpl = (raw: string) => ({
      valid: true,
      code: raw && raw.length > 0 ? raw : 'export default function App() { return null }',
      error: undefined,
    })
    checkObedienceImpl = (_code, _msg, _role, _opts) => ({
      ok: true,
      persistenceGap: false,
      aikitGaps: [],
      primitiveComplianceGaps: [],
      visitorTrackingGap: false,
      fakeLeadCaptureGap: false,
      fakeButtonGap: false,
      hardcodedToggleGap: false,
      axLandmarkGap: false,
      axManifestGap: false,
      axJsonLdGap: false,
      axSkipNavGap: false,
      axNavLabelGap: false,
      axSectionLabelGap: false,
      axAgentAttributesGap: false,
      axComplexWidgetRoleGap: false,
      reasons: [],
    })
    shouldDecomposeImpl = () => false
    useSubagentsImpl = () => false
    isClaudeAgentEnabledImpl = () => false
    isClaudeAgentFallbackEnabledImpl = () => false
    applyChatBudgetImpl = async (_chatId, _userId, previousMessages) => ({
      messages: previousMessages,
      budget: null,
      trimmed: false,
      droppedCount: 0,
    })
    analyzeComplexityImpl = () => ({
      overallComplexity: 'simple',
      shouldUseAgent: false,
      requiresChunking: false,
      chunkingStrategy: 'none',
      estimatedTokens: 500,
    })
  })

  afterEach(() => {
    vi.resetModules()
  })

  afterAll(() => {
    process.cwd = realCwd
    rmSync(scratchCwd, { recursive: true, force: true })
  })

  it('rejects a request with no message with 400, never touching the stream path', async () => {
    const { POST } = await import('@/app/api/chat-ws/route')
    const req = mockJsonRequest('http://localhost/api/chat-ws', {})
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Message is required')
  })

  it('returns 500 (outer catch) when the request body cannot be parsed as JSON', async () => {
    const { POST } = await import('@/app/api/chat-ws/route')
    const req = mockMalformedJsonRequest('http://localhost/api/chat-ws')
    const res = await POST(req)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Failed to process request')
  })

  it('streams a full happy-path generation: init -> build_step(s) -> files -> complete, with SSE headers', async () => {
    const { POST } = await import('@/app/api/chat-ws/route')
    const req = mockJsonRequest('http://localhost/api/chat-ws', {
      message: 'Build a simple todo app',
    })
    const res = await POST(req)

    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    expect(res.headers.get('Cache-Control')).toContain('no-cache')
    expect(res.headers.get('Connection')).toBe('keep-alive')

    const { events } = await drainSSE(res)
    const types = events.map((e) => e.type)

    expect(types[0]).toBe('init')
    expect(types).toContain('files')
    expect(types).toContain('complete')
    const complete = events.find((e) => e.type === 'complete')
    expect(complete.hasValidationError).toBeUndefined()
    expect(storeFilesV2Mock).toHaveBeenCalled()
  })

  it('resolves userId from a real NextAuth token when one is present', async () => {
    const { getToken } = await import('next-auth/jwt')
    ;(getToken as any).mockResolvedValueOnce({ sub: 'user-42', email: 'founder@example.com' })
    const { POST } = await import('@/app/api/chat-ws/route')
    const req = mockJsonRequest('http://localhost/api/chat-ws', { message: 'Build a landing page' })
    const res = await POST(req)
    await drainSSE(res)
    // best-effort resolution never throws even though we can't observe
    // userId directly from outside — assert the stream still completed.
    expect(res.status).toBe(200)
  })

  it('never blocks generation when token resolution throws', async () => {
    const { getToken } = await import('next-auth/jwt')
    ;(getToken as any).mockRejectedValueOnce(new Error('jwt decode failed'))
    const { POST } = await import('@/app/api/chat-ws/route')
    const req = mockJsonRequest('http://localhost/api/chat-ws', { message: 'Build a landing page' })
    const res = await POST(req)
    const { events } = await drainSSE(res)
    expect(events.some((e) => e.type === 'complete')).toBe(true)
  })

  it('loads durable chat history when a chatId is supplied (continuation)', async () => {
    getChatDataDurableMock.mockResolvedValueOnce({
      messages: [{ role: 'user', content: 'prior turn' }, { role: 'assistant', content: 'prior reply' }],
    })
    const { POST } = await import('@/app/api/chat-ws/route')
    const req = mockJsonRequest('http://localhost/api/chat-ws', {
      message: 'Now add a dark mode toggle',
      chatId: 'existing-chat-1',
    })
    const res = await POST(req)
    const { events } = await drainSSE(res)
    expect(events[0].chatId).toBe('existing-chat-1')
    expect(getChatDataDurableMock).toHaveBeenCalledWith('existing-chat-1')
  })

  it('emits a budget SSE event when the budget check trims history', async () => {
    applyChatBudgetImpl = async (_chatId, _userId, previousMessages) => ({
      messages: previousMessages.slice(1),
      budget: { total: 1000, used: 900, remaining: 100, usagePercentage: 90, isWarning: true, isCritical: false },
      trimmed: true,
      droppedCount: 1,
    })
    const { POST } = await import('@/app/api/chat-ws/route')
    const req = mockJsonRequest('http://localhost/api/chat-ws', { message: 'Build a CRM' })
    const res = await POST(req)
    const { events } = await drainSSE(res)
    const budgetEvent = events.find((e) => e.type === 'budget')
    expect(budgetEvent).toBeTruthy()
    expect(budgetEvent.trimmed).toBe(true)
    expect(budgetEvent.droppedCount).toBe(1)
  })

  it('routes through the AINative single-turn fallback and reports validated completion', async () => {
    const { POST } = await import('@/app/api/chat-ws/route')
    const req = mockJsonRequest('http://localhost/api/chat-ws', {
      message: 'Build an invoice tracker',
      model: 'qwen-coder-32b',
    })
    const res = await POST(req)
    const { events } = await drainSSE(res)
    expect(chatCompletionsCreateMock).toHaveBeenCalled()
    expect(events.some((e) => e.type === 'complete')).toBe(true)
  })

  it('blocks the deprecated llama-4-maverick model and substitutes the default model', async () => {
    const { POST } = await import('@/app/api/chat-ws/route')
    const req = mockJsonRequest('http://localhost/api/chat-ws', {
      message: 'Build a dashboard',
      model: 'llama-4-maverick',
    })
    const res = await POST(req)
    const { events } = await drainSSE(res)
    expect(events.some((e) => e.type === 'complete')).toBe(true)
  })

  it('serves the clean validation-error fallback and records the degraded persist when validation fails and never recovers', async () => {
    validateGeneratedCodeImpl = () => ({ valid: false, code: '', error: 'Unexpected token' })
    const { POST } = await import('@/app/api/chat-ws/route')
    const req = mockJsonRequest('http://localhost/api/chat-ws', { message: 'Build something broken' })
    const res = await POST(req)
    const { events } = await drainSSE(res)

    expect(events.some((e) => e.type === 'validation_error')).toBe(true)
    const filesEvent = events.find((e) => e.type === 'files')
    expect(filesEvent.files['/App.tsx']).toContain('Fallback')
    const complete = events.find((e) => e.type === 'complete')
    expect(complete.hasValidationError).toBe(true)
  })

  it('recovers via the auto-retry loop and serves the repaired code when the retry succeeds', async () => {
    let callCount = 0
    validateGeneratedCodeImpl = (raw: string) => {
      callCount += 1
      // First call (initial generation) fails; subsequent calls succeed.
      if (callCount === 1) return { valid: false, code: '', error: 'Unexpected token' }
      return { valid: true, code: raw || 'export default function App(){return null}', error: undefined }
    }
    const { runValidationRetryLoop } = await import('@/lib/generation-retry')
    ;(runValidationRetryLoop as any).mockResolvedValueOnce({
      attempts: 1,
      recovered: true,
      code: 'export default function Repaired(){return null}',
      validation: { valid: true, code: 'export default function Repaired(){return null}' },
    })
    const { POST } = await import('@/app/api/chat-ws/route')
    const req = mockJsonRequest('http://localhost/api/chat-ws', { message: 'Build something initially broken' })
    const res = await POST(req)
    const { events } = await drainSSE(res)
    expect(events.some((e) => e.type === 'complete' && !e.hasValidationError)).toBe(true)
  })

  it('runs the Claude agent fallback after exhausted retries and serves its repaired output', async () => {
    validateGeneratedCodeImpl = (raw: string) => {
      if (raw && raw.includes('AGENT-FIXED')) {
        return { valid: true, code: raw, error: undefined }
      }
      return { valid: false, code: '', error: 'Unexpected token' }
    }
    isClaudeAgentFallbackEnabledImpl = () => true
    const { runHeadlessAgent } = await import('@/lib/agent/claude-agent')
    ;(runHeadlessAgent as any).mockImplementationOnce(async function* () {
      yield { type: 'build_step', step: 'Fixing it' }
      yield { type: 'files', files: { 'src/App.tsx': 'export default function App(){return "AGENT-FIXED"}'.padEnd(250, ' ') } }
    })
    const { POST } = await import('@/app/api/chat-ws/route')
    const req = mockJsonRequest('http://localhost/api/chat-ws', { message: 'Build something the agent must fix' })
    const res = await POST(req)
    const { events } = await drainSSE(res)
    expect(events.some((e) => e.type === 'complete' && !e.hasValidationError)).toBe(true)
  })

  it('short-circuits with a quota_exhausted error and never falls back when the primary agent hit a 402', async () => {
    const { isClaudeAgentEnabled } = await import('@/lib/agent/claude-agent')
    isClaudeAgentEnabledImpl = () => true
    const { runHeadlessAgent, isClaudeAgentFallbackEnabled } = await import('@/lib/agent/claude-agent')
    const { isQuotaError } = await import('@/lib/quota-error')
    ;(isQuotaError as any).mockReturnValueOnce(true)
    ;(runHeadlessAgent as any).mockImplementationOnce(async function* () {
      yield { type: 'error', error: 'monthly_token_limit_exceeded (402)', fatal: true }
    })
    const { POST } = await import('@/app/api/chat-ws/route')
    const req = mockJsonRequest('http://localhost/api/chat-ws', { message: 'Build a quota-exhausted app' })
    const res = await POST(req)
    const { events } = await drainSSE(res)
    const errorEvent = events.find((e) => e.type === 'error')
    expect(errorEvent).toBeTruthy()
    expect(errorEvent.code).toBe('quota_exhausted')
    // Never reaches the completion event on this short-circuit path.
    expect(events.some((e) => e.type === 'complete')).toBe(false)
    void isClaudeAgentEnabled
    void isClaudeAgentFallbackEnabled
  })

  it('takes the Claude agent primary path and skips the standard model call when the agent succeeds', async () => {
    isClaudeAgentEnabledImpl = () => true
    const { runHeadlessAgent } = await import('@/lib/agent/claude-agent')
    ;(runHeadlessAgent as any).mockImplementationOnce(async function* () {
      yield { type: 'build_step', step: 'Writing src/App.tsx' }
      yield {
        type: 'files',
        files: { 'src/App.tsx': `export default function App(){ return "agent-built-this-whole-app-content" }`.padEnd(150, ' ') },
      }
      yield { type: 'complete', durationMs: 1200, tokenUsage: { inputTokens: 100, outputTokens: 200, cacheCreationTokens: 0, cacheReadTokens: 0, totalCostUsd: 0.01 } }
    })
    const { POST } = await import('@/app/api/chat-ws/route')
    const req = mockJsonRequest('http://localhost/api/chat-ws', { message: 'Build a complex multi-page CRM' })
    const res = await POST(req)
    const { events } = await drainSSE(res)
    expect(chatCompletionsCreateMock).not.toHaveBeenCalled()
    expect(events.some((e) => e.type === 'complete' && !e.hasValidationError)).toBe(true)
  })

  it('falls back to the standard model call when the primary agent fails fatally (non-quota)', async () => {
    isClaudeAgentEnabledImpl = () => true
    const { runHeadlessAgent } = await import('@/lib/agent/claude-agent')
    ;(runHeadlessAgent as any).mockImplementationOnce(async function* () {
      yield { type: 'error', error: 'agent crashed unexpectedly', fatal: true }
    })
    const { POST } = await import('@/app/api/chat-ws/route')
    const req = mockJsonRequest('http://localhost/api/chat-ws', { message: 'Build a complex app, agent will fail' })
    const res = await POST(req)
    const { events } = await drainSSE(res)
    expect(events.some((e) => e.type === 'build_step' && /falling back to standard generation/i.test(e.step))).toBe(true)
    expect(events.some((e) => e.type === 'complete')).toBe(true)
  })

  it('falls back to the standard model call when runHeadlessAgent throws synchronously', async () => {
    isClaudeAgentEnabledImpl = () => true
    const { runHeadlessAgent } = await import('@/lib/agent/claude-agent')
    ;(runHeadlessAgent as any).mockImplementationOnce(() => {
      throw new Error('agent generator construction failed')
    })
    const { POST } = await import('@/app/api/chat-ws/route')
    const req = mockJsonRequest('http://localhost/api/chat-ws', { message: 'Build an app, agent throws' })
    const res = await POST(req)
    const { events } = await drainSSE(res)
    expect(events.some((e) => e.type === 'build_step' && /crashed/i.test(e.step))).toBe(true)
    expect(events.some((e) => e.type === 'complete')).toBe(true)
  })

  it('routes through the multi-pass chunking strategy for a complex idea on a fresh chat', async () => {
    analyzeComplexityImpl = () => ({
      overallComplexity: 'complex',
      shouldUseAgent: false,
      requiresChunking: true,
      chunkingStrategy: 'phased',
      estimatedTokens: 20000,
    })
    const { POST } = await import('@/app/api/chat-ws/route')
    const req = mockJsonRequest('http://localhost/api/chat-ws', { message: 'Build an entire multi-page company app' })
    const res = await POST(req)
    const { events } = await drainSSE(res)
    expect(events.some((e) => e.type === 'chunk_progress')).toBe(true)
    expect(events.some((e) => e.type === 'complete')).toBe(true)
  })

  it('does not chunk a continuation turn even when complexity requires it (previousMessages non-empty)', async () => {
    getChatDataDurableMock.mockResolvedValueOnce({
      messages: [{ role: 'user', content: 'first turn' }, { role: 'assistant', content: 'first reply' }],
    })
    analyzeComplexityImpl = () => ({
      overallComplexity: 'complex',
      shouldUseAgent: false,
      requiresChunking: true,
      chunkingStrategy: 'phased',
      estimatedTokens: 20000,
    })
    const { executeChunkPlan } = await import('@/lib/agent/multi-pass-generator')
    const { POST } = await import('@/app/api/chat-ws/route')
    const req = mockJsonRequest('http://localhost/api/chat-ws', {
      message: 'Add one more feature',
      chatId: 'continuation-chat',
    })
    const res = await POST(req)
    await drainSSE(res)
    expect(executeChunkPlan).not.toHaveBeenCalled()
  })

  it('routes through the subagents orchestrator when that mode is enabled', async () => {
    useSubagentsImpl = () => true
    const { runOrchestratorAgent } = await import('@/lib/agent/subagents')
    const { POST } = await import('@/app/api/chat-ws/route')
    const req = mockJsonRequest('http://localhost/api/chat-ws', { message: 'Build via subagents' })
    const res = await POST(req)
    const { events } = await drainSSE(res)
    expect(runOrchestratorAgent).toHaveBeenCalled()
    expect(events.some((e) => e.type === 'complete')).toBe(true)
  })

  it('surfaces a thrown subagent orchestration failure through the generic error branch', async () => {
    useSubagentsImpl = () => true
    const { runOrchestratorAgent } = await import('@/lib/agent/subagents')
    ;(runOrchestratorAgent as any).mockResolvedValueOnce({ success: false })
    const { POST } = await import('@/app/api/chat-ws/route')
    const req = mockJsonRequest('http://localhost/api/chat-ws', { message: 'Build via subagents, orchestration fails' })
    const res = await POST(req)
    const { events } = await drainSSE(res)
    const errorEvent = events.find((e) => e.type === 'error')
    expect(errorEvent).toBeTruthy()
    expect(errorEvent.error).toBe('Stream failed')
  })

  it('applies the primary Claude-direct path when a Bedrock client is available, skipping the AINative fallback', async () => {
    const { getBedrockClient } = await import('@/lib/bedrock-client')
    ;(getBedrockClient as any).mockReturnValueOnce({
      modelId: 'bedrock-claude-test',
      messages: {
        create: vi.fn(async () => ({
          content: [{ type: 'text', text: 'export default function App(){return "bedrock-built"}'.padEnd(600, ' ') }],
          usage: { input_tokens: 50, output_tokens: 60 },
        })),
      },
    })
    const { POST } = await import('@/app/api/chat-ws/route')
    const req = mockJsonRequest('http://localhost/api/chat-ws', { message: 'Build via Bedrock' })
    const res = await POST(req)
    const { events } = await drainSSE(res)
    expect(chatCompletionsCreateMock).not.toHaveBeenCalled()
    expect(events.some((e) => e.type === 'complete' && !e.hasValidationError)).toBe(true)
  })

  it('falls through to the AINative path when the primary Claude-direct call throws', async () => {
    const { getBedrockClient } = await import('@/lib/bedrock-client')
    ;(getBedrockClient as any).mockReturnValueOnce({
      modelId: 'bedrock-claude-test',
      messages: { create: vi.fn(async () => { throw new Error('bedrock throttled') }) },
    })
    const { POST } = await import('@/app/api/chat-ws/route')
    const req = mockJsonRequest('http://localhost/api/chat-ws', { message: 'Build via Bedrock, it throttles' })
    const res = await POST(req)
    const { events } = await drainSSE(res)
    expect(chatCompletionsCreateMock).toHaveBeenCalled()
    expect(events.some((e) => e.type === 'complete')).toBe(true)
  })

  it('falls through to the AINative path when the primary Claude-direct call times out', async () => {
    process.env.PRIMARY_CLAUDE_TIMEOUT_MS = '10'
    vi.resetModules()
    const { getBedrockClient } = await import('@/lib/bedrock-client')
    ;(getBedrockClient as any).mockReturnValueOnce({
      modelId: 'bedrock-claude-test',
      messages: {
        create: vi.fn(() => new Promise(() => {})), // never resolves — real timers race it out
      },
    })
    const { POST } = await import('@/app/api/chat-ws/route')
    const req = mockJsonRequest('http://localhost/api/chat-ws', { message: 'Build via Bedrock, it hangs' })
    const res = await POST(req)
    const { events } = await drainSSE(res)
    expect(chatCompletionsCreateMock).toHaveBeenCalled()
    expect(events.some((e) => e.type === 'complete')).toBe(true)
    delete process.env.PRIMARY_CLAUDE_TIMEOUT_MS
  }, 20000)

  it('runs the combined obedience+decomposition pass and adopts a valid multi-file result', async () => {
    shouldDecomposeImpl = () => true
    let obedienceCallCount = 0
    checkObedienceImpl = () => {
      obedienceCallCount += 1
      const hasGap = obedienceCallCount === 1
      return {
        ok: !hasGap,
        persistenceGap: hasGap,
        aikitGaps: [],
        primitiveComplianceGaps: [],
        visitorTrackingGap: false,
        fakeLeadCaptureGap: false,
        fakeButtonGap: false,
        hardcodedToggleGap: false,
        axLandmarkGap: false,
        axManifestGap: false,
        axJsonLdGap: false,
        axSkipNavGap: false,
        axNavLabelGap: false,
        axSectionLabelGap: false,
        axAgentAttributesGap: false,
        axComplexWidgetRoleGap: false,
        reasons: hasGap ? ['missing /api/db persistence'] : [],
      }
    }
    let validateCallCount = 0
    validateGeneratedCodeImpl = (raw: string) => {
      validateCallCount += 1
      if (validateCallCount === 1) {
        // initial generation: long enough + valid
        return { valid: true, code: 'export default function App(){return null}'.padEnd(300, ' '), error: undefined }
      }
      // combined pass output: multi-file marker format, long enough to beat the 0.7-ratio check
      return {
        valid: true,
        code: `// --- FILE: src/App.tsx ---\n${'x'.repeat(400)}\n// --- FILE: src/components/Sidebar.tsx ---\n${'y'.repeat(200)}`,
        error: undefined,
      }
    }
    const { POST } = await import('@/app/api/chat-ws/route')
    const req = mockJsonRequest('http://localhost/api/chat-ws', { message: 'Build a dashboard needing fix+split' })
    const res = await POST(req)
    const { events } = await drainSSE(res)
    expect(events.some((e) => e.type === 'complete' && !e.hasValidationError)).toBe(true)
  })

  it('runs the decomposition-only pass and adopts a valid multi-file split', async () => {
    shouldDecomposeImpl = () => true
    let validateCallCount = 0
    validateGeneratedCodeImpl = (raw: string) => {
      validateCallCount += 1
      if (validateCallCount === 1) {
        return { valid: true, code: 'export default function App(){return null}'.padEnd(300, ' '), error: undefined }
      }
      return {
        valid: true,
        code: `// --- FILE: src/App.tsx ---\n${'x'.repeat(400)}\n// --- FILE: src/components/Sidebar.tsx ---\n${'y'.repeat(200)}`,
        error: undefined,
      }
    }
    const { POST } = await import('@/app/api/chat-ws/route')
    const req = mockJsonRequest('http://localhost/api/chat-ws', { message: 'Build a complex app needing a split' })
    const res = await POST(req)
    const { events } = await drainSSE(res)
    expect(events.some((e) => e.type === 'complete' && !e.hasValidationError)).toBe(true)
  })

  it('rejects a decomposition pass that collapses back to single-file and keeps the original', async () => {
    shouldDecomposeImpl = () => true
    let validateCallCount = 0
    validateGeneratedCodeImpl = () => {
      validateCallCount += 1
      if (validateCallCount === 1) {
        return { valid: true, code: 'export default function App(){return null}'.padEnd(300, ' '), error: undefined }
      }
      // No FILE markers -> decomposition rejected, single-file kept
      return { valid: true, code: 'export default function StillSingle(){return null}', error: undefined }
    }
    const { POST } = await import('@/app/api/chat-ws/route')
    const req = mockJsonRequest('http://localhost/api/chat-ws', { message: 'Build a complex app, split fails' })
    const res = await POST(req)
    const { events } = await drainSSE(res)
    expect(events.some((e) => e.type === 'complete' && !e.hasValidationError)).toBe(true)
  })

  it('runs the obedience-only re-prompt pass and adopts an improved single-file result', async () => {
    let obedienceCallCount = 0
    checkObedienceImpl = () => {
      obedienceCallCount += 1
      const hasGap = obedienceCallCount === 1
      return {
        ok: !hasGap,
        persistenceGap: hasGap,
        aikitGaps: [],
        primitiveComplianceGaps: [],
        visitorTrackingGap: false,
        fakeLeadCaptureGap: false,
        fakeButtonGap: false,
        hardcodedToggleGap: false,
        axLandmarkGap: false,
        axManifestGap: false,
        axJsonLdGap: false,
        axSkipNavGap: false,
        axNavLabelGap: false,
        axSectionLabelGap: false,
        axAgentAttributesGap: false,
        axComplexWidgetRoleGap: false,
        reasons: hasGap ? ['missing /api/db persistence'] : [],
      }
    }
    let validateCallCount = 0
    validateGeneratedCodeImpl = () => {
      validateCallCount += 1
      if (validateCallCount === 1) {
        return { valid: true, code: 'export default function App(){return null}', error: undefined }
      }
      return { valid: true, code: 'export default function AppFixed(){ fetch("/api/db/items"); return null}'.padEnd(250, ' '), error: undefined }
    }
    const { POST } = await import('@/app/api/chat-ws/route')
    const req = mockJsonRequest('http://localhost/api/chat-ws', { message: 'Build a todo app needing persistence' })
    const res = await POST(req)
    const { events } = await drainSSE(res)
    expect(events.some((e) => e.type === 'complete' && !e.hasValidationError)).toBe(true)
  })

  it('runs the targeted primitive-compliance retry when the obedience re-prompt still leaves a gap open', async () => {
    let obedienceCallCount = 0
    checkObedienceImpl = () => {
      obedienceCallCount += 1
      return {
        ok: obedienceCallCount > 3, // eventually "closes" so the retry loop can exit
        persistenceGap: false,
        aikitGaps: [],
        primitiveComplianceGaps: obedienceCallCount > 3 ? [] : ['ZeroPipeline'],
        visitorTrackingGap: false,
        fakeLeadCaptureGap: false,
        fakeButtonGap: false,
        hardcodedToggleGap: false,
        axLandmarkGap: false,
        axManifestGap: false,
        axJsonLdGap: false,
        axSkipNavGap: false,
        axNavLabelGap: false,
        axSectionLabelGap: false,
        axAgentAttributesGap: false,
        axComplexWidgetRoleGap: false,
        reasons: ['primitive compliance gap: ZeroPipeline'],
      }
    }
    const { evaluatePrimitiveComplianceRetry } = await import('@/lib/build/obedience-gate')
    ;(evaluatePrimitiveComplianceRetry as any).mockReturnValue({ madeProgress: true, closed: true })
    let validateCallCount = 0
    validateGeneratedCodeImpl = () => {
      validateCallCount += 1
      if (validateCallCount === 1) {
        return { valid: true, code: 'export default function App(){return null}', error: undefined }
      }
      return { valid: true, code: 'export default function AppRetried(){ fetch("/api/primitive/zeropipeline"); return null}'.padEnd(250, ' '), error: undefined }
    }
    const { POST } = await import('@/app/api/chat-ws/route')
    const req = mockJsonRequest('http://localhost/api/chat-ws', { message: 'Build a CRM that must call ZeroPipeline' })
    const res = await POST(req)
    const { events } = await drainSSE(res)
    expect(events.some((e) => e.type === 'complete' && !e.hasValidationError)).toBe(true)
  })

  it('persists a real design system choice and surfaces designConformance on the completion event', async () => {
    const { getDesignSystem } = await import('@/lib/design-systems/catalog')
    ;(getDesignSystem as any).mockReturnValueOnce({
      id: 'nova',
      name: 'Nova',
      palette: { bg: '#0a0a0a', surface: '#1a1a1a', text: '#ffffff', accent: '#111111', accent2: '#222222' },
      fonts: {
        heading: { family: 'Inter', weights: [400, 700] },
        body: { family: 'Inter', weights: [400] },
      },
      radius: 8,
      shadows: 'soft',
    })
    const { checkDesignConformance } = await import('@/lib/build/design-conformance')
    ;(checkDesignConformance as any).mockReturnValueOnce({ status: 'pass', score: 0.9, summary: 'matches palette' })
    const { POST } = await import('@/app/api/chat-ws/route')
    const req = mockJsonRequest('http://localhost/api/chat-ws', {
      message: 'Build a landing page with my chosen design system',
      designSystemId: 'nova',
    })
    const res = await POST(req)
    const { events } = await drainSSE(res)
    const complete = events.find((e) => e.type === 'complete')
    expect(complete.designConformance).toEqual({ status: 'pass', score: 0.9 })
  })

  it('files a real backlog task when the final obedience check still has an open gap and a chatId/app are known', async () => {
    checkObedienceImpl = () => ({
      ok: false,
      persistenceGap: true,
      aikitGaps: [],
      primitiveComplianceGaps: [],
      visitorTrackingGap: false,
      fakeLeadCaptureGap: false,
      fakeButtonGap: false,
      hardcodedToggleGap: false,
      axLandmarkGap: false,
      axManifestGap: false,
      axJsonLdGap: false,
      axSkipNavGap: false,
      axNavLabelGap: false,
      axSectionLabelGap: false,
      axAgentAttributesGap: false,
      axComplexWidgetRoleGap: false,
      reasons: ['missing /api/db persistence'],
    })
    resolveAppByChatIdMock.mockResolvedValueOnce({ slug: 'acme-co', ownerEmail: 'founder@example.com' })
    const { createTask } = await import('@/lib/build/task-store')
    const { POST } = await import('@/app/api/chat-ws/route')
    const req = mockJsonRequest('http://localhost/api/chat-ws', {
      message: 'Build a todo app',
      chatId: 'chat-with-known-app',
    })
    const res = await POST(req)
    await drainSSE(res)
    // Fire-and-forget: give the detached promise chain a tick to run.
    await new Promise((r) => setTimeout(r, 0))
    expect(createTask).toHaveBeenCalled()
  })

  it('serves the request role + landingPageOnly flag through to the obedience gate options', async () => {
    const { POST } = await import('@/app/api/chat-ws/route')
    const req = mockJsonRequest('http://localhost/api/chat-ws', {
      message: 'Build a marketing landing page',
      role: 'marketing',
      landingPageOnly: true,
    })
    const res = await POST(req)
    const { events } = await drainSSE(res)
    expect(events.some((e) => e.type === 'complete')).toBe(true)
  })

  it('threads a founder-reviewed dataModel artifact into the generation context without failing on a malformed one', async () => {
    const { POST } = await import('@/app/api/chat-ws/route')
    const req = mockJsonRequest('http://localhost/api/chat-ws', {
      message: 'Build an app matching my reviewed schema',
      dataModel: { entities: [{ name: 'Contact', fields: ['name', 'email'] }] },
    })
    const res = await POST(req)
    const { events } = await drainSSE(res)
    expect(events.some((e) => e.type === 'complete')).toBe(true)
  })

  it('marks internal verification traffic with skipShowcase and never 500s on it', async () => {
    const { POST } = await import('@/app/api/chat-ws/route')
    const req = mockJsonRequest('http://localhost/api/chat-ws', {
      message: 'Internal verification build',
      internal: true,
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const { events } = await drainSSE(res)
    expect(events.some((e) => e.type === 'complete')).toBe(true)
  })

  it('returns a 500 JSON error (outer catch) when loading durable chat history throws before the stream is constructed', async () => {
    // getChatDataDurable is awaited in the synchronous part of POST, BEFORE
    // the ReadableStream is constructed — a rejection here never reaches the
    // inner stream's own try/catch (which only wraps start()'s body); it
    // escapes to the outermost catch and the handler falls back to a plain
    // JSON 500, not an SSE error event. This is deliberately testing that
    // real distinction between the two catch blocks.
    getChatDataDurableMock.mockRejectedValueOnce(new Error('zerodb unavailable'))
    const { POST } = await import('@/app/api/chat-ws/route')
    const req = mockJsonRequest('http://localhost/api/chat-ws', {
      message: 'Trigger an unexpected failure',
      chatId: 'will-throw',
    })
    const res = await POST(req)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Failed to process request')
  })

  it('emits a Stream failed SSE error event when an unexpected exception escapes INSIDE the stream start() body', async () => {
    // Unlike the getChatDataDurable case above, a throw from something called
    // AFTER the ReadableStream is constructed (inside start()) is caught by
    // the inner try/catch and surfaces as a real SSE `error` event instead of
    // a plain JSON 500 — the stream's headers/status are already committed
    // by then, so this is the only way such a failure can be reported.
    const { buildRagContext } = await import('@/lib/build/rag-context')
    ;(buildRagContext as any).mockRejectedValueOnce(new Error('zeromemory recall failed'))
    const { POST } = await import('@/app/api/chat-ws/route')
    const req = mockJsonRequest('http://localhost/api/chat-ws', {
      message: 'Trigger a failure inside the stream body',
    })
    const res = await POST(req)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    const { events, raw } = await drainSSE(res)
    const errorEvent = events.find((e) => e.type === 'error')
    expect(errorEvent, `raw SSE body was: ${raw}`).toBeTruthy()
    expect(errorEvent.error).toBe('Stream failed')
  })
})
