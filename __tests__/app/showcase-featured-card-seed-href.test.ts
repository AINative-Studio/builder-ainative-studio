import { describe, it, expect } from 'vitest'
import { getShowcaseCardHref } from '@/app/showcase/page'

/**
 * Live, confirmed 2026-11-17: every SEED_SHOWCASE entry carries a legacy
 * chatId (lib/showcase-data.ts), but none of those chat ids resolve to a
 * real loadGeneration() row — /api/preview/{chatId} returns the permanent
 * "Preview Unavailable" page and /api/generation/{chatId}/files returns
 * {files:null} for all 11, confirmed via direct curl against production.
 * ShowcaseCard's Featured-strip seed fallback (used when getRecentApps()
 * returns <3 results) previously derived its link from Boolean(entry.chatId)
 * — true for every seed — sending that fallback straight into the same
 * dead end CommunityCard (showcase-client.tsx) already avoids by branching
 * on an explicit isSeed flag instead.
 */
describe('getShowcaseCardHref (Featured-strip seed fallback)', () => {
  it('routes a seed entry to its reliable static /showcase/{slug} page, even though it carries a chatId', () => {
    const entry = { slug: 'analytics-dashboard', chatId: 'XmosgqA4PVV-d1bgoTSuU' } as any
    expect(getShowcaseCardHref(entry, true)).toBe('/showcase/analytics-dashboard')
  })

  it('routes a seed entry with a non-ZeroDB chatId (e.g. agent-swarm-dashboard) the same way', () => {
    const entry = { slug: 'agent-swarm-dashboard', chatId: 'agent-swarm-dashboard' } as any
    expect(getShowcaseCardHref(entry, true)).toBe('/showcase/agent-swarm-dashboard')
  })

  it('routes a real dynamic entry to /preview/{chatId}', () => {
    const entry = { slug: 'wrench-ab12cd', chatId: 'realChatId123' } as any
    expect(getShowcaseCardHref(entry, false)).toBe('/preview/realChatId123')
  })
})
