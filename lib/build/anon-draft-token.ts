/**
 * Anonymous draft token (#E3.4) — a random, browser-scoped cookie token,
 * never PII, never logged, used purely to key server-side draft storage
 * (lib/build/anon-drafts.ts). Mirrors attribution.ts's real cookie-setting
 * pattern (document.cookie, path=/, max-age, SameSite=Lax).
 */

const COOKIE_NAME = 'ainative_anon_draft'
const MAX_AGE = 30 * 24 * 60 * 60 // 30 days — matches the real retention this token's drafts are purged on

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return m ? decodeURIComponent(m[1]) : undefined
}

function writeCookie(name: string, value: string): void {
  if (typeof document === 'undefined') return
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${MAX_AGE}; SameSite=Lax`
}

export function getOrCreateAnonDraftToken(): string {
  const existing = readCookie(COOKIE_NAME)
  if (existing) return existing
  const token = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  writeCookie(COOKIE_NAME, token)
  return token
}
