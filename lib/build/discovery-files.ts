/**
 * Live discovery-file resolution (#493) — llms.txt / robots.txt / sitemap.xml /
 * .well-known/ai-plugin.json / .well-known/security.txt for a REGISTERED
 * company's real, live `/build/{slug}` URL.
 *
 * WHY: lib/ainative-file-generator.ts's generateAINativeFileSet() is real and
 * correct, but was only ever wired into the manual "Export ZIP" download
 * (lib/services/export.service.ts) — confirmed live: builder.ainative.studio/
 * llms.txt (the platform's own) returns a real 200; builder.ainative.studio/
 * build/{any real company}/llms.txt 404s. Every generated company's live site
 * has been invisible to AI-agent discovery via the standard convention despite
 * fully correct generation code sitting unused.
 *
 * Regenerates on-demand from the DURABLE stored code (resolveStoredApp — the
 * same ZeroDB-backed resolution the ready-gate and preview routes use) rather
 * than the in-memory-only preview-store cache the export path reads, so this
 * survives restarts and works for companies generated before this fix shipped
 * — no new persistence needed, no backfill required.
 */

import { resolveApp } from '@/lib/build/app-registry'
import { resolveStoredApp } from '@/lib/build/ready-gate'
import { generateAINativeFileSet } from '@/lib/ainative-file-generator'

export type DiscoveryFileKey = 'llms.txt' | 'robots.txt' | 'sitemap.xml' | 'ai-plugin.json' | 'security.txt'

const KEY_TO_GENERATED_PATH: Record<DiscoveryFileKey, string> = {
  'llms.txt': 'public/llms.txt',
  'robots.txt': 'public/robots.txt',
  'sitemap.xml': 'public/sitemap.xml',
  'ai-plugin.json': 'public/.well-known/ai-plugin.json',
  'security.txt': 'public/.well-known/security.txt',
}

const CONTENT_TYPE: Record<DiscoveryFileKey, string> = {
  'llms.txt': 'text/plain; charset=utf-8',
  'robots.txt': 'text/plain; charset=utf-8',
  'sitemap.xml': 'application/xml; charset=utf-8',
  'ai-plugin.json': 'application/json; charset=utf-8',
  'security.txt': 'text/plain; charset=utf-8',
}

export function discoveryContentType(key: DiscoveryFileKey): string {
  return CONTENT_TYPE[key]
}

/**
 * Resolve one discovery file's real content for a registered slug. Returns
 * null when the slug isn't a real, registered company or has no durable
 * generated code to derive metadata from — the caller should 404 honestly,
 * never fabricate content for a company that doesn't exist.
 */
export async function resolveDiscoveryFile(slug: string, key: DiscoveryFileKey): Promise<string | null> {
  const clean = String(slug || '').trim()
  if (!clean) return null
  const entry = await resolveApp(clean).catch(() => null)
  if (!entry?.chatId) return null
  const stored = await resolveStoredApp(entry.chatId).catch(() => null)
  if (!stored?.code) return null

  const liveUrl = `https://builder.ainative.studio/build/${clean}`
  const files = generateAINativeFileSet(entry.tagline || entry.name || clean, stored.code, {
    name: entry.name || clean,
    description: entry.tagline || undefined,
    domain: entry.domain ? `https://${entry.domain}` : liveUrl,
  })
  return files[KEY_TO_GENERATED_PATH[key]] ?? null
}
