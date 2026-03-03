/**
 * Deploy API Route (US-067, US-068, US-069, US-070)
 * POST /api/deploy - Deploy to cloud platform
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { deployToVercel } from '@/lib/services/deployment/vercel.service'
import { deployToNetlify } from '@/lib/services/deployment/netlify.service'
import { deployToRailway } from '@/lib/services/deployment/railway.service'
import { deployToAINativeCloud } from '@/lib/services/deployment/ainative-cloud.service'
import { db } from '@/lib/db'
import { deployments } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const deployRequestSchema = z.object({
  generationId: z.string().uuid(),
  platform: z.enum(['vercel', 'netlify', 'railway', 'ainative-cloud']),
  projectName: z.string().optional(),
  teamId: z.string().optional(),
  siteName: z.string().optional(),
  environmentName: z.string().optional(),
  region: z.string().optional(),
  optimizeFor: z.enum(['cost', 'performance', 'availability']).optional(),
})

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    const userId = session?.userId

    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const body = await request.json()
    const validationResult = deployRequestSchema.safeParse(body)

    if (!validationResult.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validationResult.error.errors },
        { status: 400 }
      )
    }

    const req = validationResult.data

    // Rate limiting
    const oneHourAgo = new Date(Date.now() - 3600000)
    const recentDeployments = await db
      .select()
      .from(deployments)
      .where(eq(deployments.user_id, userId))
      .limit(10)

    if (recentDeployments.filter(d => d.created_at > oneHourAgo).length >= 5) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Max 5 deployments per hour.' },
        { status: 429 }
      )
    }

    let deploymentId: string

    switch (req.platform) {
      case 'vercel':
        deploymentId = await deployToVercel({
          generationId: req.generationId,
          userId,
          projectName: req.projectName,
          teamId: req.teamId,
        })
        break
      case 'netlify':
        deploymentId = await deployToNetlify({
          generationId: req.generationId,
          userId,
          siteName: req.siteName || req.projectName,
        })
        break
      case 'railway':
        deploymentId = await deployToRailway({
          generationId: req.generationId,
          userId,
          projectName: req.projectName,
          environmentName: req.environmentName,
        })
        break
      case 'ainative-cloud':
        deploymentId = await deployToAINativeCloud({
          generationId: req.generationId,
          userId,
          projectName: req.projectName,
          region: req.region,
          optimizeFor: req.optimizeFor,
        })
        break
    }

    const [deployment] = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, deploymentId))
      .limit(1)

    return NextResponse.json(
      {
        deploymentId: deployment.id,
        status: deployment.status,
        url: deployment.url,
        platform: deployment.platform,
        metadata: deployment.metadata,
      },
      { status: 202 }
    )
  } catch (error) {
    console.error('Deployment error:', error)
    return NextResponse.json(
      { error: 'Deployment failed', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    )
  }
}
