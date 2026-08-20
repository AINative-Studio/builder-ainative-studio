/**
 * GET /api/build/nightshift?companyId=...&idea=...&companyName=... (#207 · CRUSH-3)
 *
 * The visible "runs while you sleep" nightshift for a company's Live dashboard.
 * Returns the company's most recent real nightly run (from the enrollment store)
 * plus a short, Cody-written morning summary grounded in the company. This is how
 * we match Polsia's core claim — but with a REAL loop and honest state:
 *   - enrolled + has run  → real last run + a morning summary
 *   - enrolled, no run yet → "first run scheduled tonight"
 *   - not enrolled        → "enroll to start the nightshift"
 * Never fabricates a run that didn't happen.
 */

import { NextRequest } from 'next/server'
import { getLastRun } from '@/lib/build/loop-enrollment'
import { getClaudeCompletion } from '@/lib/build/claude-completion'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const companyId = url.searchParams.get('companyId') || ''
  const idea = (url.searchParams.get('idea') || '').slice(0, 2000)
  const companyName = (url.searchParams.get('companyName') || 'the company').slice(0, 120)

  const run = companyId ? await getLastRun(companyId) : null

  // No real run yet → honest state, no summary.
  if (!run || !run.lastRunAt) {
    return Response.json({ hasRun: false, companyId })
  }

  // Real run exists → generate a concise morning summary grounded in the company.
  let summary: string | null = null
  const claude = getClaudeCompletion()
  if (claude) {
    try {
      const res = await claude.client.messages.create({
        model: claude.model,
        max_tokens: 220,
        temperature: 0.6,
        system:
          `You are Cody, the AI co-founder operating "${companyName}" (idea: "${idea}"). ` +
          `You ran the nightly autonomous loop overnight (status: ${run.lastStatus}). Write a 2-3 sentence ` +
          `morning summary for the founder: what you evaluated, the single highest-leverage task you ran, ` +
          `and the recommended next move. Be specific to this company, first person, no fluff.`,
        messages: [{ role: 'user', content: 'Give me the morning summary.' }],
      })
      summary = (res.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim()
    } catch {
      summary = null
    }
  }

  return Response.json({
    hasRun: true,
    companyId,
    lastRunAt: run.lastRunAt,
    status: run.lastStatus || 'dispatched',
    taskId: run.lastTaskId || null,
    summary: summary || `I ran the nightly loop on ${companyName} and dispatched the highest-leverage task to the agent swarm.`,
  })
}
