/**
 * /api/ask (#1679) — NLWeb-convention conversational endpoint for agent
 * discovery, AX scan 2026-10-29 (0/4, "no /ask endpoint").
 *
 * This is NOT a new knowledge base. It is a thin, standard-path front door
 * onto the SAME real, already-grounded "ask anything about Builder" logic
 * that already exists at /api/build/help (#60) — curated FAQ retrieval
 * (lib/build/help-faq.ts) + Claude, with a real-FAQ-answer fallback if no
 * model is reachable. /api/build/help was already agent-queryable in
 * practice; it just wasn't discoverable at the path an agent probing for
 * NLWeb's /ask convention (or reading openapi.json / llms.txt) would look
 * for. This route fixes discovery, not capability.
 *
 * Distinct from /api/build/ask (#207/#287/#288/#52), which is a DIFFERENT,
 * per-company-scoped endpoint (requires {question, idea}) for Cody chat on a
 * specific generated app's Live dashboard, with persistent per-company
 * memory. /api/ask answers questions about Builder-the-product in general —
 * it does not touch that route or its memory.
 *
 * POST body: { question: string } — also accepts { query } (the NLWeb-
 * convention field name) as an alias for the same field.
 * POST returns: { answer, sources: [{ id, question }], model, provider }
 */

import { NextRequest } from 'next/server'
import { POST as helpPost } from '@/app/api/build/help/route'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const question = body?.question ?? body?.query
  // helpPost only calls request.json() on its input — forward the minimal
  // contract it actually uses rather than reconstructing a full NextRequest.
  return helpPost({ json: async () => ({ question }) } as NextRequest)
}
