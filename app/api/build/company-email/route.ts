/**
 * POST /api/build/company-email (#733, child of #414) — the real entry point
 * for Cody (or the nightly loop) to email a company's founder or one of
 * their customers on that company's behalf.
 *
 * Thin wrapper over lib/build/company-email.ts's sendCompanyEmail: unlike
 * SMS/voice (company-comms/route.ts), email needs no founder-scoped
 * credential resolution or provisioned-number check — it's a flat Resend
 * send using AINative's own already-verified sender identity with the
 * company's name as the display name. This route exists so the standalone
 * MCP server process the agent runtime spawns (lib/agent/mcp-servers/
 * company-comms-mcp-server.mjs) can reach it over a plain HTTP call, the
 * same way it reaches company-comms/route.ts for SMS/voice, rather than
 * attempting a cross-runtime import of TypeScript source from a bare Node
 * ESM child process.
 *
 * Body: { companyName: string, to: string, subject: string, html?: string,
 *         text?: string }
 * Returns: { ok: true, id? } | { ok: false, reason }
 *
 * Fails closed, never fabricates success — see sendCompanyEmail's own doc
 * comment for the real Resend-verified-sender constraint this respects.
 */

import { NextRequest } from 'next/server'
import { sendCompanyEmail } from '@/lib/build/company-email'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const companyName = String(body?.companyName || '').trim()
  const to = String(body?.to || '').trim()
  const subject = String(body?.subject || '').trim()
  const html = typeof body?.html === 'string' ? body.html : ''
  const text = typeof body?.text === 'string' ? body.text : ''

  if (!companyName) return Response.json({ ok: false, reason: 'companyName required' }, { status: 400 })
  if (!to) return Response.json({ ok: false, reason: 'to required' }, { status: 400 })
  if (!subject) return Response.json({ ok: false, reason: 'subject required' }, { status: 400 })

  const result = await sendCompanyEmail(companyName, to, subject, html, text || html)
  if (!result.ok) return Response.json({ ok: false, reason: result.reason || 'send_failed' })
  return Response.json({ ok: true, id: result.id })
}
