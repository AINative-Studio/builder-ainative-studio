import { NextRequest } from 'next/server'
import { saveArtifactVersion } from '@/lib/build/artifact-versions'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => null)
  const companyId = String(b?.companyId || '')
  const view = String(b?.view || '')
  if (!companyId || !view) return Response.json({ ok: false, reason: 'invalid_request' }, { status: 400 })

  const result = await saveArtifactVersion(companyId, view, b?.content, b?.label)
  return Response.json(result, { status: 200 })
}
