/**
 * Content language (#57) — the language Cody writes generated artifacts, reports,
 * and nightly summaries in. Chosen on Account → Settings, persisted to the real
 * AINative account, and injected into every generation context so the OUTPUT is
 * actually in the founder's language (matching Polsia's "Daily report emails +
 * research are written in this language").
 *
 * This module is the single source of truth for:
 *   - the supported language catalog (code → human label),
 *   - normalization of an arbitrary/legacy value into a supported code,
 *   - the instruction string injected into generation prompts.
 *
 * Deliberately dependency-free (pure functions) so it's trivially unit-testable
 * and safe to import on both server (API routes) and client (Settings form).
 */

export interface ContentLanguage {
  /** BCP-47-ish short code persisted to the account, e.g. 'en', 'es', 'pt-BR'. */
  code: string
  /** Human label shown in the picker, e.g. 'English', 'Português (Brasil)'. */
  label: string
  /** English endonym used inside the model instruction, e.g. 'Brazilian Portuguese'. */
  promptName: string
}

/**
 * Supported content languages. English is the default. The list is intentionally
 * curated (not every ISO language) to the set we can generate high-quality
 * artifacts in; add entries here to expand coverage.
 */
export const CONTENT_LANGUAGES: readonly ContentLanguage[] = [
  { code: 'en', label: 'English', promptName: 'English' },
  { code: 'es', label: 'Español', promptName: 'Spanish' },
  { code: 'pt-BR', label: 'Português (Brasil)', promptName: 'Brazilian Portuguese' },
  { code: 'fr', label: 'Français', promptName: 'French' },
  { code: 'de', label: 'Deutsch', promptName: 'German' },
  { code: 'it', label: 'Italiano', promptName: 'Italian' },
  { code: 'nl', label: 'Nederlands', promptName: 'Dutch' },
  { code: 'ja', label: '日本語', promptName: 'Japanese' },
  { code: 'ko', label: '한국어', promptName: 'Korean' },
  { code: 'zh', label: '中文（简体）', promptName: 'Simplified Chinese' },
  { code: 'hi', label: 'हिन्दी', promptName: 'Hindi' },
  { code: 'ar', label: 'العربية', promptName: 'Arabic' },
] as const

/** The default content language when the account has none set. */
export const DEFAULT_CONTENT_LANGUAGE = 'en'

const BY_CODE: Record<string, ContentLanguage> = Object.fromEntries(
  CONTENT_LANGUAGES.map((l) => [l.code.toLowerCase(), l]),
)

/** True if `code` is one of the supported content-language codes (case-insensitive). */
export function isSupportedLanguage(code: unknown): boolean {
  return typeof code === 'string' && code.toLowerCase() in BY_CODE
}

/**
 * Normalize an arbitrary/legacy language value into a supported code. Accepts the
 * exact code ('pt-BR'), a case variant ('PT-br'), a bare primary subtag ('pt' →
 * 'pt-BR' when that's the only pt- variant), or an unknown value (→ default).
 * Never throws; always returns a code that exists in CONTENT_LANGUAGES.
 */
export function normalizeLanguage(code: unknown): string {
  if (typeof code !== 'string') return DEFAULT_CONTENT_LANGUAGE
  const raw = code.trim().toLowerCase()
  if (!raw) return DEFAULT_CONTENT_LANGUAGE
  // Exact (case-insensitive) match.
  if (raw in BY_CODE) return BY_CODE[raw].code
  // Primary-subtag match: 'pt' matches 'pt-br', 'zh-hans' matches 'zh'.
  const primary = raw.split('-')[0]
  const hit = CONTENT_LANGUAGES.find((l) => l.code.toLowerCase().split('-')[0] === primary)
  return hit ? hit.code : DEFAULT_CONTENT_LANGUAGE
}

/** Resolve a code to its ContentLanguage record (falls back to the default). */
export function resolveLanguage(code: unknown): ContentLanguage {
  return BY_CODE[normalizeLanguage(code).toLowerCase()]
}

/**
 * The instruction appended to a generation system prompt so the model writes its
 * human-readable output in the founder's language. Returns '' for English (the
 * models default to English, so no instruction is needed — keeps prompts lean).
 *
 * Structural tokens (JSON keys, code, identifiers, URLs) must stay untouched;
 * only human-readable VALUES are translated — this is called out explicitly so a
 * JSON-schema artifact stays parseable.
 */
export function languageInstruction(code: unknown): string {
  const lang = resolveLanguage(code)
  if (lang.code === DEFAULT_CONTENT_LANGUAGE) return ''
  return (
    `Write all human-readable text in ${lang.promptName}. ` +
    `Keep JSON keys, code, identifiers, URLs, and any structural tokens exactly as specified in English — ` +
    `translate only the human-readable string VALUES.`
  )
}
