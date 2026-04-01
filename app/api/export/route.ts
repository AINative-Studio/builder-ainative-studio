import { NextRequest, NextResponse } from 'next/server'
import { exportProject } from '@/lib/export/project-exporter'
import { getFiles } from '@/lib/preview-store-v2'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { files, appName = 'AINativeApp', chatId } = body

    // Get files from store if chatId provided
    let projectFiles = files
    if (!projectFiles && chatId) {
      projectFiles = getFiles(chatId)
      if (!projectFiles) {
        return NextResponse.json({ error: 'Session not found or expired' }, { status: 404 })
      }
    }

    if (!projectFiles || Object.keys(projectFiles).length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 })
    }

    const zipData = await exportProject(projectFiles, appName)

    return new NextResponse(zipData, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${appName.toLowerCase().replace(/[^a-z0-9-]/g, '-')}.zip"`,
      },
    })
  } catch (error) {
    console.error('Export error:', error)
    return NextResponse.json({ error: 'Failed to export project' }, { status: 500 })
  }
}
