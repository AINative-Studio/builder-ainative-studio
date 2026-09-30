/**
 * Markdown content negotiation for agent crawlers (AX/agent-readiness scan,
 * 2026-09-30) — two real gaps in one fix:
 *
 *  1. The homepage ignored `Accept: text/markdown` entirely (always HTML, no
 *     `Vary: Accept`) — an agent asking for a lightweight, parseable summary
 *     got the full React app shell instead.
 *  2. A genuinely nonexistent path used to 307-redirect to `/login` (fixed
 *     separately in middleware.ts's protected-routes fallback) — this module
 *     additionally gives that case a real Markdown body when Markdown was
 *     requested, per the scan's "point agents to your docs/sitemap/llms.txt"
 *     guidance, rather than just a bare 404 status.
 *
 * Deliberately pure + exported so both branches are unit-testable without a
 * real request/response round-trip.
 */

const SITE = 'https://builder.ainative.studio'

/** Does this Accept header genuinely prefer Markdown over HTML? Mirrors real
 *  content-negotiation semantics: `text/markdown` must appear, and — when
 *  `text/html` is ALSO present — Markdown must not be strictly lower quality
 *  (a bare `Accept: text/html` must never match). */
export function prefersMarkdown(acceptHeader: string | null): boolean {
  if (!acceptHeader) return false
  const accept = acceptHeader.toLowerCase()
  if (!accept.includes('text/markdown')) return false
  if (!accept.includes('text/html')) return true
  // Both present — compare q-values (default 1 when unspecified).
  const qOf = (type: string): number => {
    const re = new RegExp(`${type}[^,]*?(?:;\\s*q=([0-9.]+))?(?:,|$)`)
    const m = accept.match(re)
    if (!m) return 0
    return m[1] !== undefined ? parseFloat(m[1]) : 1
  }
  return qOf('text/markdown') >= qOf('text/html')
}

/** The homepage's Markdown representation — a compact, agent-friendly summary
 *  mirroring llms.txt's own framing so the two never contradict each other. */
export function homepageMarkdown(): string {
  return `# AINative Builder

> AI that builds AND runs your company. Describe an idea; Cody (your AI
> co-founder) composes a real, running product or an operating AI-native
> company from real AINative primitives, then runs it 24/7.

## Start here

- Build: ${SITE}/build
- Pricing: ${SITE}/pricing
- Docs: ${SITE}/docs
- Full agent index: ${SITE}/llms.txt
- API reference: ${SITE}/openapi.json

## What it is

Describe a one-line idea and Cody builds the artifacts (product brief, PRD,
data model, agent definitions, business model, positioning, landing page,
30-day plan), a real working app you can share, provisions infrastructure on
real AINative primitives, and keeps running the company on a nightly
autonomous loop.
`
}

/** The Markdown 404 body for a genuinely unknown path — real status, real
 *  explanation, real pointers to recover (per the scan's own "How to pass"
 *  guidance: at least 20 characters explaining the error, plus docs/sitemap/
 *  llms.txt links). */
export function notFoundMarkdown(pathname: string): string {
  return `# 404 — Not Found

The path \`${pathname}\` does not exist on AINative Builder. It may have been
renamed, removed, or mistyped.

## Where to look instead

- Sitemap: ${SITE}/sitemap.xml
- Agent index: ${SITE}/llms.txt
- API reference: ${SITE}/openapi.json
- Docs: ${SITE}/docs
- Home: ${SITE}/
`
}
