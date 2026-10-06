import { NextRequest } from 'next/server'
import { saveAnonDraft, loadAnonDraft } from '@/lib/build/anon-drafts'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => null)
  const token = String(b?.token || '')
  if (!token) return Response.json({ ok: false, reason: 'invalid_request' }, { status: 400 })

  const result = await saveAnonDraft(token, {
    idea: String(b?.idea || ''),
    track: b?.track === 'app' ? 'app' : 'company',
    answers: b?.answers || {},
    step: String(b?.step || ''),
  })
  return Response.json(result, { status: 200 })
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') || ''
  if (!token) return Response.json({ draft: null })
  const draft = await loadAnonDraft(token)
  return Response.json({ draft })
}
