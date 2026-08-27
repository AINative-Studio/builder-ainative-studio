import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { AINATIVE_API_BASE_URL } from '@/lib/constants'
import { getUserPlan, getDefaultPlan } from '@/lib/services/plan.service'

/**
 * GET /api/credits — current user's credit balance and usage (#312).
 *
 * Reads the AUTHORITATIVE per-user credit LEDGER (not the Sila USD wallet):
 *   - GET /v1/public/credits/balance         → granted / used / remaining credits (+ reset date)
 *   - GET /v1/public/credits/usage/current   → current billing-period usage detail
 *
 * Both are called with the signed-in user's access token. The response is
 * normalized so the UI reads integer *credits remaining*, never a USD amount.
 */

/** Normalized credit ledger shape the UI consumes. All fields may be null. */
export interface NormalizedCredits {
  /** Total credits granted for the current period. */
  granted: number | null
  /** Credits consumed so far this period. */
  used: number | null
  /** Credits still available (granted - used), integer credits. */
  remaining: number | null
  /**
   * Alias of `remaining` kept for the nav chip / callers that read `balance`.
   * This is a CREDIT count, not USD.
   */
  balance: number | null
  /** ISO timestamp the ledger resets, or null when unknown. */
  resetsAt: string | null
  /** True for unlimited plans (enterprise) — UI shows "Unlimited", not a count. */
  unlimited?: boolean
  /** The plan id from the ledger (e.g. "enterprise"), when present. */
  plan?: string | null
}

function num(...vals: unknown[]): number | null {
  for (const v of vals) {
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  }
  return null
}

function str(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim() !== '') return v
  }
  return null
}

/**
 * Map the raw /credits/balance body onto the normalized ledger shape. The
 * platform has surfaced these fields under a few names across versions, so we
 * probe the common ones and derive `remaining` when only granted/used exist.
 */
export function normalizeCredits(balanceBody: any): NormalizedCredits {
  const b = balanceBody?.data ?? balanceBody ?? null
  if (!b) {
    return { granted: null, used: null, remaining: null, balance: null, resetsAt: null }
  }

  // Unlimited plans (e.g. enterprise) report unlimited:true with total/remaining = -1.
  // Surface that as unlimited rather than a nonsensical -1 balance.
  const unlimited = b.unlimited === true

  let granted = num(b.granted, b.total, b.credits_granted, b.total_credits, b.limit, b.allowance)
  const used = num(b.used, b.credits_used, b.consumed, b.usage, b.used_credits)
  let remaining = num(b.remaining, b.balance, b.credits_remaining, b.available, b.credits, b.remaining_credits)

  // The sentinel -1 means "unlimited", not a real count.
  if (granted === -1) granted = null
  if (remaining === -1) remaining = null

  // Derive remaining from granted/used when the ledger only reports those.
  if (!unlimited && remaining === null && granted !== null && used !== null) {
    remaining = Math.max(0, granted - used)
  }

  const resetsAt = str(
    b.resetsAt,
    b.resets_at,
    b.reset_at,
    b.period_end,
    b.current_period_end,
    b.next_reset,
    b.renews_at,
  )

  return { granted, used, remaining, balance: remaining, resetsAt, unlimited, plan: str(b.plan) }
}

export async function GET(_request: NextRequest) {
  try {
    const session = await auth()

    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const accessToken = (session as any).accessToken
    if (!accessToken) {
      // Guest / local accounts have no ledger — fall back to a default plan.
      const plan = getDefaultPlan(session.user.type)
      return NextResponse.json({
        credits: normalizeCredits(null),
        usage: null,
        plan,
        userType: session.user.type,
      })
    }

    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    }

    // Read the authoritative credit ledger (balance + current-period usage) in
    // parallel, alongside the existing plan lookup.
    const [balanceRes, usageRes] = await Promise.allSettled([
      fetch(`${AINATIVE_API_BASE_URL}/v1/public/credits/balance`, { headers }),
      fetch(`${AINATIVE_API_BASE_URL}/v1/public/credits/usage/current`, { headers }),
    ])

    const balanceBody =
      balanceRes.status === 'fulfilled' && balanceRes.value.ok
        ? await balanceRes.value.json().catch(() => null)
        : null

    const usage =
      usageRes.status === 'fulfilled' && usageRes.value.ok
        ? await usageRes.value.json().catch(() => null)
        : null

    const plan = await getUserPlan(accessToken)
    const credits = normalizeCredits(balanceBody)

    return NextResponse.json({
      credits,
      usage,
      plan,
      userType: session.user.type,
    })
  } catch (error) {
    console.error('[Credits API] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch credits' }, { status: 500 })
  }
}
