/**
 * Orchestration for the shared Text-Cody number (#936) — resolves an
 * inbound text on the shared number (not a dedicated per-company number) to
 * a specific company's conversation, or a clear reply explaining why not.
 *
 * Real ordering constraint: resolveFounderCredential() is keyed by company
 * SLUG, not founder email, so tier cannot be checked until at least one
 * company is known. Order here: lookup founder -> list companies -> zero
 * companies short-circuits before any tier check (nothing to be paid for)
 * -> tier resolved via the FIRST company's credential (tier is a founder-
 * level AINative plan property — any one of their companies' stored
 * credential reveals the same plan) -> gate -> disambiguate among 2+.
 */

import { findFounderByPhone } from '@/lib/build/founder-phones'
import { listAppsForOwner } from '@/lib/build/app-registry'
import { resolveFounderCredential } from '@/lib/build/primitive-credentials'
import { getPlanStatus, isPaidTier } from '@/lib/ainative/plan'
import { getPendingDisambiguation, setPendingDisambiguation, clearPendingDisambiguation } from '@/lib/build/sms-disambiguation'

export interface SharedNumberResult {
  replyText: string | null
  resolvedSlug: string | null
  resolvedOwnerEmail: string | null
}

const NO_MATCH_REPLY = "Text us from the phone number on your AINative account, or sign up at builder.ainative.studio"
const NO_COMPANIES_REPLY = "You don't have any companies yet — head to builder.ainative.studio to start one."
const NOT_PAID_REPLY = "Texting Cody is a paid-plan feature — upgrade at builder.ainative.studio to turn this on."

function noMatch(): SharedNumberResult {
  return { replyText: NO_MATCH_REPLY, resolvedSlug: null, resolvedOwnerEmail: null }
}

function disambiguationPrompt(companies: Array<{ slug: string; name: string }>): string {
  return `Which company? Reply with a number:\n${companies.map((c, i) => `${i + 1}. ${c.name}`).join('\n')}`
}

export async function handleSharedNumberSms(from: string, body: string): Promise<SharedNumberResult> {
  try {
    const founder = await findFounderByPhone(from)
    if (!founder) return noMatch()

    const companies = await listAppsForOwner(founder.email)
    if (companies.length === 0) {
      return { replyText: NO_COMPANIES_REPLY, resolvedSlug: null, resolvedOwnerEmail: null }
    }

    // Tier check via the first company's stored credential (any company's
    // credential reveals the same founder-level plan).
    const cred = await resolveFounderCredential(companies[0].slug, 'zerovoice')
    let paid = false
    if (cred.ok && cred.accessToken) {
      try {
        const status = await getPlanStatus(cred.accessToken)
        paid = isPaidTier(status.tier)
      } catch {
        paid = false // fail closed
      }
    }
    if (!paid) {
      return { replyText: NOT_PAID_REPLY, resolvedSlug: null, resolvedOwnerEmail: null }
    }

    if (companies.length === 1) {
      return { replyText: null, resolvedSlug: companies[0].slug, resolvedOwnerEmail: founder.email }
    }

    // 2+ companies: check for a pending disambiguation reply first.
    const pending = await getPendingDisambiguation(from)
    if (pending) {
      const trimmed = body.trim()
      const choice = /^\d+$/.test(trimmed) ? parseInt(trimmed, 10) : null
      if (choice !== null && choice >= 1 && choice <= pending.length) {
        const chosen = pending[choice - 1]
        await clearPendingDisambiguation(from)
        return { replyText: null, resolvedSlug: chosen.slug, resolvedOwnerEmail: founder.email }
      }
      // Invalid reply — re-send the SAME pending list, don't silently fail.
      return { replyText: disambiguationPrompt(pending), resolvedSlug: null, resolvedOwnerEmail: null }
    }

    // No pending state yet — this is the founder's first text: ask.
    const list = companies.map((c) => ({ slug: c.slug, name: c.name || c.slug }))
    await setPendingDisambiguation(from, list)
    return { replyText: disambiguationPrompt(list), resolvedSlug: null, resolvedOwnerEmail: null }
  } catch {
    return noMatch()
  }
}
