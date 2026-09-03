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
import { languageInstruction, normalizeLanguage } from '@/lib/build/content-language'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const companyId = url.searchParams.get('companyId') || ''
  const idea = (url.searchParams.get('idea') || '').slice(0, 2000)
  const companyName = (url.searchParams.get('companyName') || 'the company').slice(0, 120)
  // Founder's content language (#57) — the morning summary is written in it.
  const contentLanguage = normalizeLanguage(url.searchParams.get('lang'))

  const run = companyId ? await getLastRun(companyId) : null

  // No real run yet → honest state, no summary.
  if (!run || !run.lastRunAt) {
    return Response.json({ hasRun: false, companyId })
  }

  // Real run exists → generate a concise morning summary grounded ONLY in the
  // fields we actually have (lastStatus/lastTaskId/lastRunAt). The route used
  // to ask Claude to invent "what I evaluated" / "the recommended next move"
  // with zero real task content passed in — no title, no output, nothing from
  // the actual run. Claude had no grounding for that, and would sometimes
  // (correctly, per its own training) write an honest refusal to fabricate
  // specifics instead of a summary — which then rendered verbatim on the
  // dashboard as if it WERE the summary (2026-09 beacon repro). Until real
  // task content (title/output) can be threaded through from task-store.ts —
  // that needs an owner/scope key this route doesn't currently have — the
  // prompt must not ask for first-person specifics it can't back up.
  let summary: string | null = null
  const claude = getClaudeCompletion()
  if (claude) {
    try {
      const res = await claude.client.messages.create({
        model: claude.model,
        max_tokens: 120,
        temperature: 0.5,
        system:
          `You are Cody, the AI co-founder operating "${companyName}" (idea: "${idea}"). ` +
          `The nightly autonomous loop ran overnight; its recorded status is "${run.lastStatus || 'dispatched'}". ` +
          `Write ONE short, honest sentence for the founder confirming the run happened and its status. ` +
          `Do NOT invent or imply specifics about what was evaluated, what task ran, or what to do next — ` +
          `you have no record of that, only the status. First person, no fluff.` +
          (languageInstruction(contentLanguage) ? ` ${languageInstruction(contentLanguage)}` : ''),
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
