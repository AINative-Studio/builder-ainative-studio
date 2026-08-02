/**
 * Evidence Verification API
 * POST /api/evidence/verify - Verify that the evidence required for a commit
 *                             exists and is passing (blocks "false confidence").
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  getEvidenceVerifierService,
  DEFAULT_COVERAGE_THRESHOLD,
} from '@/lib/services/evidence-verifier.service'

const evidenceTypeEnum = z.enum([
  'test-run',
  'build',
  'coverage',
  'deployment',
  'screenshot',
  'lint',
  'type-check',
  'command-execution',
])

const verifySchema = z.object({
  user_id: z.string().uuid(),
  message: z.string().optional(),
  files: z.array(z.string()).optional(),
  requiredEvidence: z.array(evidenceTypeEnum).optional(),
  gitBranch: z.string().optional(),
  coverageThreshold: z.number().min(0).max(100).default(DEFAULT_COVERAGE_THRESHOLD),
})

/**
 * POST /api/evidence/verify
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const params = verifySchema.parse(body)

    const verifier = getEvidenceVerifierService()
    const result = await verifier.verifyCommit({
      userId: params.user_id,
      message: params.message,
      files: params.files,
      requiredEvidence: params.requiredEvidence,
      gitBranch: params.gitBranch,
      coverageThreshold: params.coverageThreshold,
    })

    return NextResponse.json({
      passed: result.passed,
      missingEvidence: result.missingEvidence,
      failedEvidence: result.failedEvidence,
      coverage: result.coverage,
      message: result.message,
    })
  } catch (error) {
    console.error('Evidence verification error:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request body', details: error.issues },
        { status: 400 }
      )
    }

    return NextResponse.json(
      {
        error: 'Failed to verify evidence',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
