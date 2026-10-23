/**
 * Existing-site assessment (#1306) — "Grow my existing business" (growthIntent)
 * currently only swaps which kickoff questions are asked; there is no real
 * assessment of the business the founder already has. This module is a
 * small, HONEST first cut: fetch the founder's existing site, parse a
 * handful of real signals (title tag, meta description, heading structure),
 * and report exactly what was found — never a stub, never a faked "all
 * good" result.
 *
 * Deliberately NOT a Lighthouse integration or an exhaustive SEO audit —
 * see the issue's own "not scoped yet" note. This stays a small, real
 * parsing pass (~well under 100 lines) plus honest failure handling.
 */

export interface SiteAssessment {
  hasTitle: boolean
  title: string
  hasMetaDescription: boolean
  metaDescription: string
  /** A present-but-short (<50 char) meta description is a real, distinct
   *  signal from "missing entirely" — both are reportable gaps. */
  metaDescriptionThin: boolean
  hasH1: boolean
  hasH2: boolean
  /** More than one h1 on a page is itself a real, reportable SEO issue. */
  h1Count: number
  /** Short, honest, founder-facing summary of what was found. */
  summary: string
}

export type SiteAssessmentResult =
  | { ok: true; assessment: SiteAssessment }
  | { ok: false; error: string }

const THIN_DESCRIPTION_THRESHOLD = 50
const FETCH_TIMEOUT_MS = 8000

/** Pure parsing — no network. Exported so the parsing logic is testable in isolation. */
export function analyzeHtml(html: string): SiteAssessment {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch ? titleMatch[1].trim() : ''
  const hasTitle = title.length > 0

  const metaMatch =
    html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i) ??
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i)
  const metaDescription = metaMatch ? metaMatch[1].trim() : ''
  const hasMetaDescription = metaDescription.length > 0
  const metaDescriptionThin = hasMetaDescription && metaDescription.length < THIN_DESCRIPTION_THRESHOLD

  const h1Matches = html.match(/<h1[\s>]/gi) ?? []
  const h1Count = h1Matches.length
  const hasH1 = h1Count > 0
  const hasH2 = /<h2[\s>]/i.test(html)

  const gaps: string[] = []
  if (!hasTitle) gaps.push('no title tag')
  if (!hasMetaDescription) gaps.push('no meta description')
  else if (metaDescriptionThin) gaps.push('thin meta description')
  if (!hasH1) gaps.push('no H1 tag')
  else if (h1Count > 1) gaps.push(`${h1Count} H1 tags (should be one)`)

  const summary = gaps.length > 0
    ? `Found: ${gaps.join(', ')}.`
    : 'Looks healthy: has a title, meta description, and a clear H1.'

  return {
    hasTitle, title,
    hasMetaDescription, metaDescription, metaDescriptionThin,
    hasH1, hasH2, h1Count,
    summary,
  }
}

/** Adds a scheme if the founder typed a bare domain ("acme.com"). */
function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function isPlausibleUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    // Require at least one dot in the hostname — rejects junk like "https://x".
    return parsed.hostname.includes('.')
  } catch {
    return false
  }
}

/**
 * Fetch the founder's existing site and run the light parsing pass above.
 * Always resolves (never throws) — fetch failures, timeouts, and non-200
 * responses all come back as an honest ok:false with a clear error, never a
 * silent crash or a faked "all good".
 */
export async function fetchAndAssessSite(rawUrl: string): Promise<SiteAssessmentResult> {
  const url = normalizeUrl(rawUrl)
  if (!isPlausibleUrl(url)) {
    return { ok: false, error: `Invalid URL: "${rawUrl}" doesn't look like a real website address.` }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) {
      return { ok: false, error: `Fetching ${url} failed (HTTP ${res.status}).` }
    }
    const html = await res.text()
    return { ok: true, assessment: analyzeHtml(html) }
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown error'
    return { ok: false, error: `Could not reach ${url} (${reason}).` }
  } finally {
    clearTimeout(timeout)
  }
}
