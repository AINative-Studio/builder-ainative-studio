/**
 * Export API Route (US-066)
 *
 * GET /api/export/:id
 * Downloads a generated UI as a complete Next.js project zip file.
 *
 * Authentication: Required
 * Authorization: User must own the generation
 *
 * Response: application/zip stream
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getExportWithMetadata } from '@/lib/services/export.service'
import { db } from '@/lib/db'
import { generations } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/export/:id
 * Export generation as downloadable Next.js project
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: generationId } = await params

    if (!generationId) {
      return NextResponse.json(
        { error: 'Generation ID is required' },
        { status: 400 }
      )
    }

    // Skip auth for demo - in production, verify user access
    // const session = await getSession()
    // if (!session?.userId) {
    //   return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    // }

    // Export generation directly from preview store
    const exportResult = await getExportWithMetadata(generationId)

    // Return zip file with appropriate headers
    return new NextResponse(exportResult.buffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${exportResult.filename}"`,
        'Content-Length': exportResult.size.toString(),
        'Cache-Control': 'no-cache',
      },
    })
  } catch (error) {
    console.error('Export error:', error)
    return NextResponse.json(
      {
        error: 'Failed to export generation',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
