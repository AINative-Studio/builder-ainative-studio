import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { AINATIVE_API_BASE_URL } from '@/lib/constants'
import { getUserPlan, getDefaultPlan } from '@/lib/services/plan.service'

/**
 * GET /api/credits - Get current user's credit balance and usage
 * Proxies to AINative platform APIs:
 *   - /v1/payments/wallets/me/balance (wallet balance)
 *   - /v1/managed/usage (current usage stats)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth()

    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const accessToken = (session as any).accessToken
    if (!accessToken) {
      // Non-AINative users get default plan
      const plan = getDefaultPlan(session.user.type)
      return NextResponse.json({
        balance: null,
        usage: null,
        plan,
        userType: session.user.type,
      })
    }

    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    }

    // Fetch balance and usage in parallel
    const [balanceRes, usageRes] = await Promise.allSettled([
      fetch(`${AINATIVE_API_BASE_URL}/v1/payments/wallets/me/balance`, { headers }),
      fetch(`${AINATIVE_API_BASE_URL}/v1/managed/usage`, { headers }),
    ])

    const balance = balanceRes.status === 'fulfilled' && balanceRes.value.ok
      ? await balanceRes.value.json()
      : null

    const usage = usageRes.status === 'fulfilled' && usageRes.value.ok
      ? await usageRes.value.json()
      : null

    // Get plan details
    const plan = await getUserPlan(accessToken)

    return NextResponse.json({
      balance,
      usage,
      plan,
      userType: session.user.type,
    })
  } catch (error) {
    console.error('[Credits API] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch credits' },
      { status: 500 },
    )
  }
}
