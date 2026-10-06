import { NextRequest } from 'next/server'
import { explainBeforeBuilding } from '@/lib/build/cody-chat'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => null)
  const view = String(b?.view || '')
  const track = b?.track === 'app' ? 'app' : 'company'
  if (!view) return Response.json({ ok: false, reason: 'invalid_request' }, { status: 400 })

  const result = await explainBeforeBuilding(view, track, String(b?.idea || ''))
  return Response.json(result, { status: 200 })
}
