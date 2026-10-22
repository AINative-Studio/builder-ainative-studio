import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for prompt-builder.service.ts (Epic 4): the orchestration
 * layer that wires translation, intent detection, example selection,
 * token-budget management, and component docs injection into one system
 * prompt. Each collaborator service is mocked so these tests exercise only
 * prompt-builder's own branching: section assembly, constraints section,
 * component-doc filtering by mentioned names, design-token formatting, and
 * the top-level try/catch fallback.
 */

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const detectAndTranslateMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/services/translation.service', () => ({
  detectAndTranslate: detectAndTranslateMock,
}))

const detectUITypeMock = vi.hoisted(() => vi.fn())
const getExampleCategoryMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/services/intent-detector.service', () => ({
  detectUIType: detectUITypeMock,
  getExampleCategory: getExampleCategoryMock,
}))

const selectExamplesBySimilarityMock = vi.hoisted(() => vi.fn())
const formatExamplesForPromptMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/services/example-selector.service', () => ({
  selectExamplesBySimilarity: selectExamplesBySimilarityMock,
  formatExamplesForPrompt: formatExamplesForPromptMock,
}))

const truncateToTokenBudgetMock = vi.hoisted(() => vi.fn())
const formatTokenBudgetMock = vi.hoisted(() => vi.fn())
const calculateTokenBudgetMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/services/token-counter.service', () => ({
  truncateToTokenBudget: truncateToTokenBudgetMock,
  formatTokenBudget: formatTokenBudgetMock,
  calculateTokenBudget: calculateTokenBudgetMock,
}))

const detectApplicableComponentsMock = vi.hoisted(() => vi.fn())
const formatComponentsForPromptMock = vi.hoisted(() => vi.fn())
const calculateTokenSavingsMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/services/component-registry.service', () => ({
  detectApplicableComponents: detectApplicableComponentsMock,
  formatComponentsForPrompt: formatComponentsForPromptMock,
  calculateTokenSavings: calculateTokenSavingsMock,
}))

function defaultHappyPathMocks() {
  // Echo the input prompt back untranslated by default, so each test's
  // own prompt text flows through to component-name extraction, etc.
  detectAndTranslateMock.mockImplementation(async (text: string) => ({
    language: 'en',
    confidence: 1,
    originalText: text,
    translatedText: text,
    wasTranslated: false,
  }))
  detectUITypeMock.mockReturnValue({
    type: 'dashboard',
    confidence: 0.9,
    keywords: ['dashboard'],
    typeSpecificInstructions: 'Use charts and KPI cards.',
  })
  getExampleCategoryMock.mockReturnValue('dashboard')
  selectExamplesBySimilarityMock.mockResolvedValue({
    examples: [{ id: 'ex1' }],
    method: 'semantic',
    selectionTimeMs: 10,
  })
  formatExamplesForPromptMock.mockReturnValue('FEW SHOT EXAMPLES SECTION')
  detectApplicableComponentsMock.mockReturnValue([{ name: 'Card' }])
  formatComponentsForPromptMock.mockReturnValue('AI KIT COMPONENTS SECTION')
  calculateTokenSavingsMock.mockReturnValue({ totalSavings: 500, percentageSavings: 20 })
  truncateToTokenBudgetMock.mockImplementation((sections: any) => ({
    sections,
    truncation: { truncated: false, original: 1000, final: 1000, sectionsRemoved: [], sectionsKept: Object.keys(sections) },
  }))
  calculateTokenBudgetMock.mockReturnValue({ total: 1000 })
  formatTokenBudgetMock.mockReturnValue('budget: 1000 tokens')
}

describe('buildEnhancedPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    defaultHappyPathMocks()
  })

  it('assembles a full result on the happy path with all metadata populated', async () => {
    const { buildEnhancedPrompt } = await import('@/lib/services/prompt-builder.service')

    const result = await buildEnhancedPrompt('build a dashboard with charts')

    expect(result.metadata.originalLanguage).toBe('en')
    expect(result.metadata.wasTranslated).toBe(false)
    expect(result.metadata.detectedUIType).toBe('dashboard')
    expect(result.metadata.uiTypeConfidence).toBe(0.9)
    expect(result.metadata.examplesCount).toBe(1)
    expect(result.metadata.examplesMethod).toBe('semantic')
    expect(result.metadata.aiKitComponentsDetected).toBe(1)
    expect(result.metadata.tokenSavingsEstimate).toBe(500)
    expect(result.metadata.wasTruncated).toBe(false)
    expect(result.systemPrompt).toContain('AI KIT COMPONENTS SECTION')
    expect(result.systemPrompt).toContain('FEW SHOT EXAMPLES SECTION')
  })

  it('appends the UI-type-specific instructions to the user prompt when present', async () => {
    const { buildEnhancedPrompt } = await import('@/lib/services/prompt-builder.service')

    const result = await buildEnhancedPrompt('build a dashboard')

    expect(result.enhancedPrompt).toContain('Use charts and KPI cards.')
  })

  it('leaves the prompt unmodified when the intent detector has no type-specific instructions', async () => {
    detectUITypeMock.mockReturnValue({
      type: 'unknown',
      confidence: 0.1,
      keywords: [],
      typeSpecificInstructions: '',
    })
    const { buildEnhancedPrompt } = await import('@/lib/services/prompt-builder.service')

    const result = await buildEnhancedPrompt('asdf qwerty')
    expect(result.enhancedPrompt).toBe('asdf qwerty')
  })

  it('uses the translated text as the working prompt when translation occurred', async () => {
    detectAndTranslateMock.mockResolvedValue({
      language: 'es',
      confidence: 0.8,
      originalText: 'crear un panel',
      translatedText: 'create a dashboard',
      wasTranslated: true,
    })
    const { buildEnhancedPrompt } = await import('@/lib/services/prompt-builder.service')

    const result = await buildEnhancedPrompt('crear un panel')

    expect(result.metadata.originalLanguage).toBe('es')
    expect(result.metadata.wasTranslated).toBe(true)
    expect(result.enhancedPrompt).toContain('create a dashboard')
  })

  it('injects design tokens into the system prompt when provided', async () => {
    const { buildEnhancedPrompt } = await import('@/lib/services/prompt-builder.service')

    const result = await buildEnhancedPrompt('build a dashboard', {
      light: {
        colors: { primary: '#111111' },
        typography: { fontFamily: 'Inter' },
        spacing: { baseUnit: '4px' },
      },
    } as any)

    expect(result.systemPrompt).toContain('DESIGN SYSTEM TOKENS')
    expect(result.systemPrompt).toContain('#111111')
  })

  it('omits the design tokens section entirely when none are provided', async () => {
    const { buildEnhancedPrompt } = await import('@/lib/services/prompt-builder.service')

    const result = await buildEnhancedPrompt('build a dashboard', null)
    expect(result.systemPrompt).not.toContain('DESIGN SYSTEM TOKENS')
  })

  it('injects component documentation only for components explicitly mentioned in the prompt', async () => {
    const { buildEnhancedPrompt } = await import('@/lib/services/prompt-builder.service')

    const result = await buildEnhancedPrompt('build a page using a Button and a Card')

    expect(result.systemPrompt).toContain('COMPONENT DOCUMENTATION')
    expect(result.systemPrompt).toContain('COMPONENT: Button')
    expect(result.systemPrompt).toContain('COMPONENT: Card')
    // Not mentioned -> not included.
    expect(result.systemPrompt).not.toContain('COMPONENT: Table')
  })

  it('omits the component documentation section when no known component names are mentioned', async () => {
    const { buildEnhancedPrompt } = await import('@/lib/services/prompt-builder.service')

    const result = await buildEnhancedPrompt('build something generic')
    expect(result.systemPrompt).not.toContain('COMPONENT DOCUMENTATION')
    expect(result.metadata.componentDocsInjected).toBe(0)
  })

  it('reflects truncation metadata when the token budget step reports truncation', async () => {
    truncateToTokenBudgetMock.mockImplementation((sections: any) => ({
      sections,
      truncation: {
        truncated: true,
        original: 5000,
        final: 2000,
        sectionsRemoved: ['fewShotExamples'],
        sectionsKept: ['userPrompt', 'constraints'],
      },
    }))
    const { buildEnhancedPrompt } = await import('@/lib/services/prompt-builder.service')

    const result = await buildEnhancedPrompt('build a dashboard')
    expect(result.metadata.wasTruncated).toBe(true)
  })

  it('always includes the constraints section in the final system prompt', async () => {
    const { buildEnhancedPrompt } = await import('@/lib/services/prompt-builder.service')

    const result = await buildEnhancedPrompt('anything')
    expect(result.systemPrompt).toContain('CRITICAL CONSTRAINTS')
  })

  it('falls back to a minimal result when an upstream collaborator throws', async () => {
    detectAndTranslateMock.mockRejectedValue(new Error('translation service unavailable'))
    const { buildEnhancedPrompt } = await import('@/lib/services/prompt-builder.service')

    const result = await buildEnhancedPrompt('build a dashboard')

    expect(result.enhancedPrompt).toBe('build a dashboard')
    expect(result.systemPrompt).toContain('CRITICAL CONSTRAINTS')
    expect(result.metadata.originalLanguage).toBe('en')
    expect(result.metadata.wasTranslated).toBe(false)
    expect(result.metadata.detectedUIType).toBe('unknown')
    expect(result.metadata.examplesMethod).toBe('fallback')
    expect(result.metadata.tokenBudget.breakdown).toBe('Error occurred')
  })

  it('still falls back gracefully when the example selector throws mid-pipeline', async () => {
    selectExamplesBySimilarityMock.mockRejectedValue(new Error('embedding API down'))
    const { buildEnhancedPrompt } = await import('@/lib/services/prompt-builder.service')

    const result = await buildEnhancedPrompt('build a dashboard')
    expect(result.metadata.examplesMethod).toBe('fallback')
    expect(result.enhancedPrompt).toBe('build a dashboard')
  })
})
