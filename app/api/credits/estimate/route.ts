import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { AINATIVE_API_BASE_URL } from '@/lib/constants'

/**
 * POST /api/credits/estimate - Estimate credit cost before generation
 * Proxies to AINative: POST /v1/managed/estimate
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth()

    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const accessToken = (session as any).accessToken
    if (!accessToken) {
      return NextResponse.json({
        estimated_credits: 0,
        message: 'Credit estimation available for AINative users only',
      })
    }

    const body = await request.json()

    const response = await fetch(`${AINATIVE_API_BASE_URL}/v1/managed/estimate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('[Credits Estimate] AINative API error:', response.status, error)
      return NextResponse.json(
        { error: 'Failed to estimate credits' },
        { status: response.status },
      )
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('[Credits Estimate] Error:', error)
    return NextResponse.json(
      { error: 'Failed to estimate credits' },
      { status: 500 },
    )
  }
}
