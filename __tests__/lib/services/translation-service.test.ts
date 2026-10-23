import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Unit tests for translation.service.ts (US-034): keyword-pattern language
 * detection (pure logic, exercised directly) plus OpenAI-backed
 * translation, where the `openai` SDK client is mocked at its constructor
 * boundary so no real network call is made.
 */

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const createCompletionMock = vi.hoisted(() => vi.fn())
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: createCompletionMock } },
  })),
}))

describe('detectLanguage', () => {
  it('returns unknown with zero confidence for empty text', async () => {
    const { detectLanguage } = await import('@/lib/services/translation.service')
    const result = detectLanguage('')

    expect(result).toEqual({ language: 'unknown', confidence: 0, originalText: '' })
  })

  it('returns unknown for whitespace-only text', async () => {
    const { detectLanguage } = await import('@/lib/services/translation.service')
    const result = detectLanguage('   ')

    expect(result.language).toBe('unknown')
  })

  it('detects English for a typical UI-building prompt', async () => {
    const { detectLanguage } = await import('@/lib/services/translation.service')
    const result = detectLanguage('Create a dashboard with a table and a button for the user')

    expect(result.language).toBe('en')
    expect(result.confidence).toBeGreaterThan(0)
  })

  it('detects Spanish from Spanish UI-building keywords', async () => {
    const { detectLanguage } = await import('@/lib/services/translation.service')
    const result = detectLanguage('Crear un panel con un formulario y un botón para el usuario')

    expect(result.language).toBe('es')
  })

  it('detects French from French UI-building keywords', async () => {
    const { detectLanguage } = await import('@/lib/services/translation.service')
    const result = detectLanguage('Créer un tableau de bord avec un formulaire et un bouton pour l\'utilisateur')

    expect(result.language).toBe('fr')
  })

  it('detects German from German UI-building keywords', async () => {
    const { detectLanguage } = await import('@/lib/services/translation.service')
    const result = detectLanguage('Erstellen Sie ein Dashboard mit einem Formular und einem Button für den Benutzer')

    expect(result.language).toBe('de')
  })

  it('detects Japanese from kanji/kana characters', async () => {
    const { detectLanguage } = await import('@/lib/services/translation.service')
    const result = detectLanguage('ダッシュボードを作成してユーザーのためのフォームとボタンを表示してください')

    expect(result.language).toBe('ja')
  })

  it('defaults to English when confidence is too low to be decisive', async () => {
    const { detectLanguage } = await import('@/lib/services/translation.service')
    const result = detectLanguage('xyz123 !!! ###')

    expect(result.language).toBe('en')
  })
})

describe('getLanguageName', () => {
  it('maps every supported code to its display name', async () => {
    const { getLanguageName } = await import('@/lib/services/translation.service')

    expect(getLanguageName('en')).toBe('English')
    expect(getLanguageName('es')).toBe('Spanish')
    expect(getLanguageName('fr')).toBe('French')
    expect(getLanguageName('de')).toBe('German')
    expect(getLanguageName('ja')).toBe('Japanese')
    expect(getLanguageName('unknown')).toBe('Unknown')
  })
})

describe('translateToEnglish', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the text unchanged when sourceLanguage is already "en"', async () => {
    const { translateToEnglish } = await import('@/lib/services/translation.service')
    const result = await translateToEnglish('hello world', 'en')

    expect(result).toBe('hello world')
    expect(createCompletionMock).not.toHaveBeenCalled()
  })

  it('returns the text unchanged when no OpenAI API key is configured', async () => {
    delete process.env.OPENAI_API_KEY
    const { translateToEnglish } = await import('@/lib/services/translation.service')

    const result = await translateToEnglish('hola mundo', 'es')
    expect(result).toBe('hola mundo')
    expect(createCompletionMock).not.toHaveBeenCalled()
  })

  it('returns the OpenAI-translated text when the API key is set and the call succeeds', async () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    createCompletionMock.mockResolvedValue({
      choices: [{ message: { content: 'hello world' } }],
    })
    const { translateToEnglish } = await import('@/lib/services/translation.service')

    const result = await translateToEnglish('hola mundo', 'es')
    expect(result).toBe('hello world')
    expect(createCompletionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-3.5-turbo',
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'system', content: expect.stringContaining('Spanish') }),
        ]),
      }),
      expect.objectContaining({ signal: expect.anything() })
    )
  })

  it('falls back to the original text when the OpenAI call throws', async () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    createCompletionMock.mockRejectedValue(new Error('rate limited'))
    const { translateToEnglish } = await import('@/lib/services/translation.service')

    const result = await translateToEnglish('hola mundo', 'es')
    expect(result).toBe('hola mundo')
  })

  it('falls back to the original text when the completion has no content', async () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    createCompletionMock.mockResolvedValue({ choices: [{ message: {} }] })
    const { translateToEnglish } = await import('@/lib/services/translation.service')

    const result = await translateToEnglish('hola mundo', 'es')
    expect(result).toBe('hola mundo')
  })
})

describe('detectAndTranslate', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the text untranslated when the detected language is English', async () => {
    const { detectAndTranslate } = await import('@/lib/services/translation.service')
    const result = await detectAndTranslate('Create a dashboard with a table')

    expect(result.language).toBe('en')
    expect(result.wasTranslated).toBe(false)
    expect(result.translatedText).toBe('Create a dashboard with a table')
    expect(createCompletionMock).not.toHaveBeenCalled()
  })

  it('returns the text untranslated when the detected language is unknown', async () => {
    const { detectAndTranslate } = await import('@/lib/services/translation.service')
    const result = await detectAndTranslate('')

    expect(result.language).toBe('unknown')
    expect(result.wasTranslated).toBe(false)
  })

  it('translates and marks wasTranslated true when a non-English language is detected and OpenAI returns a different string', async () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    createCompletionMock.mockResolvedValue({
      choices: [{ message: { content: 'create a dashboard with a form and a button' } }],
    })
    const { detectAndTranslate } = await import('@/lib/services/translation.service')

    const result = await detectAndTranslate(
      'Crear un panel con un formulario y un botón para el usuario'
    )

    expect(result.language).toBe('es')
    expect(result.wasTranslated).toBe(true)
    expect(result.translatedText).toBe('create a dashboard with a form and a button')
  })

  it('marks wasTranslated false when the translation call falls back to the identical original text', async () => {
    delete process.env.OPENAI_API_KEY
    const { detectAndTranslate } = await import('@/lib/services/translation.service')

    const original = 'Crear un panel con un formulario y un botón para el usuario'
    const result = await detectAndTranslate(original)

    expect(result.language).toBe('es')
    expect(result.wasTranslated).toBe(false)
    expect(result.translatedText).toBe(original)
  })
})
