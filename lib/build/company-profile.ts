/**
 * "What Cody has learned" company profile (#693) — a periodically-refreshed
 * synthesis of real founder-Cody conversation memories, surfaced on the Live
 * dashboard alongside #608's chat handoff summary.
 *
 * Real gap: ZeroMemory's /reflect + /profile endpoints (core: Refs #2960)
 * were fully live and confirmed working, but nothing in Builder ever called
 * them — Builder accumulated real per-company memories but never synthesized
 * them into anything a founder (or Cody) could read back.
 *
 * Entity scoping decision (the design question #693 itself raised): use the
 * exact same `scopeKey` (chatScopeKey(ownerKey, slug)) #608's chat-summary
 * and saveExchange already persist real Q&A history under — one stable
 * identity per founder-company pair, not the ephemeral per-generation id
 * storeGenerationMemory/processConversation use elsewhere in this codebase.
 *
 * Regeneration policy: reflectOnEntity is a real LLM call server-side, so —
 * mirroring chat-summary.ts's MIN_NEW_TURNS_TO_REGENERATE — only re-run it
 * once enough NEW memories have accumulated since the last reflection, read
 * via getEntityProfile's own authoritative memory_count field (not a
 * client-side counter, which could drift from what's actually stored).
 * reflect() itself also requires 3+ memories total or it honestly returns
 * zero insights — surfaced here as "not enough yet" rather than an error.
 */

import { reflectOnEntity, getEntityProfile, type EntityProfile } from '@/lib/agent/zeromemory'

/** Minimum NEW memories since the last reflection before running another one. */
export const MIN_NEW_MEMORIES_TO_REFLECT = 3

/** The real endpoint's own floor — reflecting below this always returns zero insights. */
export const MIN_TOTAL_MEMORIES_TO_REFLECT = 3

export interface CompanyProfile {
  summary: string | null
  preferences: string[]
  behaviors: string[]
  facts: string[]
  memoryCount: number
  lastInteraction: string | null
}

/**
 * Pure decision: given the current memory count and what a prior reflection
 * covered, is a fresh reflect() call worth its real LLM-call cost?
 */
export function shouldReflect(memoryCount: number, lastReflectedCount: number): boolean {
  if (memoryCount < MIN_TOTAL_MEMORIES_TO_REFLECT) return false
  return memoryCount - lastReflectedCount >= MIN_NEW_MEMORIES_TO_REFLECT
}

function toCompanyProfile(profile: EntityProfile): CompanyProfile {
  return {
    summary: profile.summary,
    preferences: profile.preferences,
    behaviors: profile.behaviors,
    facts: profile.facts,
    memoryCount: profile.memoryCount,
    lastInteraction: profile.lastInteraction,
  }
}

/**
 * Ensure a fresh company profile exists for a scope, reflecting only when
 * warranted. Best-effort — never throws. Returns the profile to show right
 * now (freshly reflected, or the existing one when reflection wasn't
 * warranted/failed), or null when there's nothing to show yet (no memories,
 * or the profile call itself failed).
 */
export async function ensureCompanyProfile(scopeKey: string): Promise<CompanyProfile | null> {
  if (!scopeKey) return null
  try {
    const existing = await getEntityProfile(scopeKey)
    if (!existing) return null

    // memory_count on the profile response IS the "already reflected" mark
    // once a real profile has been generated (summary is non-null); before
    // that, lastReflectedCount is 0 — any real memory count clears the
    // MIN_NEW_MEMORIES_TO_REFLECT bar on the very first pass.
    const lastReflectedCount = existing.summary ? existing.memoryCount : 0
    if (!shouldReflect(existing.memoryCount, lastReflectedCount)) {
      return existing.summary || existing.memoryCount > 0 ? toCompanyProfile(existing) : null
    }

    const reflection = await reflectOnEntity(scopeKey)
    if (!reflection || reflection.memoriesReviewed < MIN_TOTAL_MEMORIES_TO_REFLECT) {
      // Reflection didn't run or found too few memories — fall back to
      // whatever profile already existed rather than silently showing nothing.
      return existing.summary || existing.memoryCount > 0 ? toCompanyProfile(existing) : null
    }

    // reflect() writes the synthesized profile server-side — read it back
    // fresh rather than trusting the reflect response's own shape (insights[]
    // is a raw LLM extraction list, not the same {preferences,behaviors,facts,
    // summary} shape get_profile returns).
    const refreshed = await getEntityProfile(scopeKey)
    if (!refreshed) return toCompanyProfile(existing)
    return toCompanyProfile(refreshed)
  } catch {
    return null
  }
}
