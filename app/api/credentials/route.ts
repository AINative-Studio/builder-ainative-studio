/**
 * Credentials API (US-071)
 * GET /api/credentials - List saved credentials platforms
 * POST /api/credentials - Save new credentials
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { saveCredentials, listCredentialPlatforms, Platform } from '@/lib/services/credentials.service'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const credentialSchema = z.object({
  platform: z.enum(['vercel', 'netlify', 'railway', 'ainative-cloud']),
  token: z.string().min(10),
})

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    const userId = session?.user?.id

    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const platforms = await listCredentialPlatforms(userId)
    return NextResponse.json({ platforms })
  } catch (error) {
    console.error('Credentials list error:', error)
    return NextResponse.json({ error: 'Failed to list credentials' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    const userId = session?.user?.id

    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const body = await request.json()
    const validation = credentialSchema.safeParse(body)

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validation.error.errors },
        { status: 400 }
      )
    }

    const { platform, token } = validation.data
    const credentialId = await saveCredentials(userId, platform as Platform, token)

    return NextResponse.json(
      { success: true, credentialId, platform },
      { status: 201 }
    )
  } catch (error) {
    console.error('Credentials save error:', error)
    return NextResponse.json({ error: 'Failed to save credentials' }, { status: 500 })
  }
}
