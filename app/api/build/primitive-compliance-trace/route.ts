/**
 * GET /api/build/primitive-compliance-trace?chatId=... (issue #624 follow-up,
 * 2026-09-10) — read the durable trace of chat-ws's targeted primitive-
 * compliance retry (closePrimitiveComplianceGap) for a specific generation.
 *
 * Exists because live verification of that retry via `railway logs` proved
 * unreliable — the CLI's rolling buffer showed no evidence the retry had run
 * for a real generation, even after the retry was confirmed correct by
 * source inspection and passing unit tests. This is the real, queryable
 * ground truth instead: did the retry run, on which branch, how many
 * attempts, what gaps existed before/after, and did it close.
 *
 * Returns: { chatId, traces: PrimitiveComplianceTraceRow[] }
 */

import { NextRequest } from 'next/server'
import { readComplianceTrace } from '@/lib/build/primitive-compliance-trace'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const chatId = new URL(request.url).searchParams.get('chatId') || ''
  if (!chatId) return Response.json({ error: 'chatId required' }, { status: 400 })
  const traces = await readComplianceTrace(chatId)
  return Response.json({ chatId, traces })
}
