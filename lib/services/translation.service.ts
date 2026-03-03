/**
 * Translation Service (US-034)
 *
 * Detects prompt language and translates to English for LLM processing.
 * Supports: EN, ES, FR, DE, JP
 */

import OpenAI from 'openai'
import { logger } from '../logger'

export type SupportedLanguage = 'en' | 'es' | 'fr' | 'de' | 'ja' | 'unknown'

export interface LanguageDetectionResult {
  language: SupportedLanguage
  confidence: number
  originalText: string
}

export interface TranslationResult extends LanguageDetectionResult {
  translatedText: string
  wasTranslated: boolean
}

// Language detection patterns (simple keyword-based for common UI terms)
const LANGUAGE_PATTERNS: Record<SupportedLanguage, RegExp[]> = {
  en: [
    /\b(create|build|make|generate|dashboard|form|button|table)\b/i,
    /\b(the|a|an|and|or|with|for|to)\b/i
  ],
  es: [
    /\b(crear|construir|generar|panel|formulario|botón|tabla)\b/i,
    /\b(el|la|los|las|un|una|y|o|con|para|de)\b/i,
    /\b(añadir|mostrar|página|usuario|datos)\b/i
  ],
  fr: [
    /\b(créer|construire|générer|tableau|formulaire|bouton)\b/i,
    /\b(le|la|les|un|une|et|ou|avec|pour|de)\b/i,
    /\b(ajouter|afficher|page|utilisateur|données)\b/i
  ],
  de: [
    /\b(erstellen|bauen|generieren|dashboard|formular|button|tabelle)\b/i,
    /\b(der|die|das|ein|eine|und|oder|mit|für|von)\b/i,
    /\b(hinzufügen|anzeigen|seite|benutzer|daten)\b/i
  ],
  ja: [
    /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/,  // Hiragana, Katakana, Kanji
    /(作成|構築|生成|ダッシュボード|フォーム|ボタン|テーブル)/,
    /(追加|表示|ページ|ユーザー|データ)/
  ],
  unknown: []
}

/**
 * Detect language from text using simple pattern matching
 *
 * @param text Text to detect language for
 * @returns Language detection result
 */
export function detectLanguage(text: string): LanguageDetectionResult {
  if (!text || text.trim().length === 0) {
    return {
      language: 'unknown',
      confidence: 0,
      originalText: text
    }
  }

  const scores: Record<SupportedLanguage, number> = {
    en: 0,
    es: 0,
    fr: 0,
    de: 0,
    ja: 0,
    unknown: 0
  }

  // Score each language based on pattern matches
  for (const [lang, patterns] of Object.entries(LANGUAGE_PATTERNS)) {
    if (lang === 'unknown') continue

    for (const pattern of patterns) {
      const matches = text.match(pattern)
      if (matches) {
        scores[lang as SupportedLanguage] += matches.length
      }
    }
  }

  // Find language with highest score
  let maxScore = 0
  let detectedLang: SupportedLanguage = 'en' // Default to English

  for (const [lang, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score
      detectedLang = lang as SupportedLanguage
    }
  }

  // Calculate confidence (0-1)
  const totalWords = text.split(/\s+/).length
  const confidence = Math.min(maxScore / Math.max(totalWords * 0.3, 1), 1)

  // If confidence is too low, default to English
  if (confidence < 0.3) {
    detectedLang = 'en'
  }

  return {
    language: detectedLang,
    confidence,
    originalText: text
  }
}

/**
 * Translate text to English using OpenAI
 *
 * @param text Text to translate
 * @param sourceLanguage Source language (if known)
 * @returns Translated text
 */
export async function translateToEnglish(
  text: string,
  sourceLanguage?: SupportedLanguage
): Promise<string> {
  // If already English, return as-is
  if (sourceLanguage === 'en') {
    return text
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY

    if (!apiKey) {
      logger.warn('OpenAI API key not configured, skipping translation')
      return text
    }

    const openai = new OpenAI({ apiKey })

    const languageNames: Record<SupportedLanguage, string> = {
      en: 'English',
      es: 'Spanish',
      fr: 'French',
      de: 'German',
      ja: 'Japanese',
      unknown: 'unknown'
    }

    const sourceLangName = sourceLanguage
      ? languageNames[sourceLanguage]
      : 'the source language'

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: `You are a translator. Translate the following text from ${sourceLangName} to English. Preserve the meaning and intent. Return ONLY the translated text, no explanations.`
        },
        {
          role: 'user',
          content: text
        }
      ],
      temperature: 0.3,
      max_tokens: 500
    })

    const translated = response.choices[0]?.message?.content || text

    logger.info('Translation completed', {
      sourceLanguage,
      originalLength: text.length,
      translatedLength: translated.length
    })

    return translated
  } catch (error) {
    logger.error('Translation failed', { error, sourceLanguage })
    // Fallback: return original text
    return text
  }
}

/**
 * Detect language and translate if needed
 *
 * @param text Text to process
 * @returns Translation result with language info
 */
export async function detectAndTranslate(text: string): Promise<TranslationResult> {
  const detection = detectLanguage(text)

  // If English or detection failed, return original
  if (detection.language === 'en' || detection.language === 'unknown') {
    return {
      ...detection,
      translatedText: text,
      wasTranslated: false
    }
  }

  // Translate to English
  const translatedText = await translateToEnglish(text, detection.language)

  return {
    ...detection,
    translatedText,
    wasTranslated: translatedText !== text
  }
}

/**
 * Get language name from code
 *
 * @param code Language code
 * @returns Language name
 */
export function getLanguageName(code: SupportedLanguage): string {
  const names: Record<SupportedLanguage, string> = {
    en: 'English',
    es: 'Spanish',
    fr: 'French',
    de: 'German',
    ja: 'Japanese',
    unknown: 'Unknown'
  }

  return names[code] || 'Unknown'
}
