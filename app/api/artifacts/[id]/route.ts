/**
 * Artifact Download API Endpoint
 * GET /api/artifacts/[id] - Download artifact file
 */

import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import { db } from '@/lib/db'
import { artifacts } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params

    // Get artifact metadata
    const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, id)).limit(1)

    if (!artifact) {
      return NextResponse.json({ error: 'Artifact not found' }, { status: 404 })
    }

    // Read file content
    const content = await fs.readFile(artifact.storage_path)

    // Return file with appropriate headers
    return new NextResponse(content, {
      headers: {
        'Content-Type': artifact.mime_type,
        'Content-Disposition': `attachment; filename="${artifact.name}"`,
        'Content-Length': artifact.size.toString(),
      },
    })
  } catch (error) {
    console.error('Artifact download error:', error)

    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json({ error: 'Artifact file not found' }, { status: 404 })
    }

    return NextResponse.json({ error: 'Failed to download artifact' }, { status: 500 })
  }
}
