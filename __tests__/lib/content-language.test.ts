import { describe, it, expect } from 'vitest'

/**
 * #57 — content-language: the language Cody writes generated artifacts/reports in.
 * Pure functions; no I/O. Covers normalization (exact/case/primary-subtag/unknown),
 * support checks, and the model instruction (empty for English, translative else).
 */
import {
  CONTENT_LANGUAGES,
  DEFAULT_CONTENT_LANGUAGE,
  isSupportedLanguage,
  normalizeLanguage,
  resolveLanguage,
  languageInstruction,
} from '@/lib/build/content-language'

describe('content-language catalog (#57)', () => {
  it('has English as the default and includes it in the catalog', () => {
    expect(DEFAULT_CONTENT_LANGUAGE).toBe('en')
    expect(CONTENT_LANGUAGES.some((l) => l.code === 'en')).toBe(true)
  })

  it('every catalog entry has code, label, promptName', () => {
    for (const l of CONTENT_LANGUAGES) {
      expect(l.code).toBeTruthy()
      expect(l.label).toBeTruthy()
      expect(l.promptName).toBeTruthy()
    }
  })
})

describe('isSupportedLanguage (#57)', () => {
  it('accepts supported codes (case-insensitive)', () => {
    expect(isSupportedLanguage('en')).toBe(true)
    expect(isSupportedLanguage('PT-br')).toBe(true)
    expect(isSupportedLanguage('es')).toBe(true)
  })
  it('rejects unknown/invalid values', () => {
    expect(isSupportedLanguage('xx')).toBe(false)
    expect(isSupportedLanguage('')).toBe(false)
    expect(isSupportedLanguage(null)).toBe(false)
    expect(isSupportedLanguage(42 as unknown)).toBe(false)
  })
})

describe('normalizeLanguage (#57)', () => {
  it('returns the exact supported code', () => {
    expect(normalizeLanguage('es')).toBe('es')
    expect(normalizeLanguage('pt-BR')).toBe('pt-BR')
  })
  it('canonicalizes case', () => {
    expect(normalizeLanguage('ES')).toBe('es')
    expect(normalizeLanguage('pt-br')).toBe('pt-BR')
  })
  it('matches a bare primary subtag to its variant', () => {
    expect(normalizeLanguage('pt')).toBe('pt-BR')
    expect(normalizeLanguage('zh-Hans')).toBe('zh')
  })
  it('falls back to default for unknown / empty / non-string', () => {
    expect(normalizeLanguage('klingon')).toBe(DEFAULT_CONTENT_LANGUAGE)
    expect(normalizeLanguage('')).toBe(DEFAULT_CONTENT_LANGUAGE)
    expect(normalizeLanguage(undefined)).toBe(DEFAULT_CONTENT_LANGUAGE)
    expect(normalizeLanguage(123 as unknown)).toBe(DEFAULT_CONTENT_LANGUAGE)
  })
})

describe('resolveLanguage (#57)', () => {
  it('resolves to the full record', () => {
    expect(resolveLanguage('es').promptName).toBe('Spanish')
    expect(resolveLanguage('pt-BR').promptName).toBe('Brazilian Portuguese')
  })
  it('resolves unknown to the default record', () => {
    expect(resolveLanguage('nope').code).toBe(DEFAULT_CONTENT_LANGUAGE)
  })
})

describe('languageInstruction (#57)', () => {
  it('is empty for English (models default to English — keeps prompts lean)', () => {
    expect(languageInstruction('en')).toBe('')
    expect(languageInstruction('EN')).toBe('')
    expect(languageInstruction('unknown')).toBe('') // → default en → empty
  })
  it('names the target language and protects structural tokens for non-English', () => {
    const instr = languageInstruction('es')
    expect(instr).toContain('Spanish')
    expect(instr).toMatch(/JSON keys|identifiers|structural/i)
    expect(instr).toMatch(/translate only/i)
  })
  it('uses the promptName endonym, not the code', () => {
    expect(languageInstruction('pt-BR')).toContain('Brazilian Portuguese')
  })
})
