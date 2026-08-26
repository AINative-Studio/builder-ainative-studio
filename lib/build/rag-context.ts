/**
 * RAG codegen context (#81 · Phase 7a, epic #303).
 *
 * The Bedrock codegen hot path (app/api/chat-ws) had NO memory read — every build
 * was context-free, ignoring what worked on prior similar builds. ZeroMemory recall
 * (lib/agent/zeromemory.ts recallPastPerformance) already exists and is battle-tested
 * on the dormant agent path; this module adapts its output into a codegen-appropriate
 * prompt block and keeps the wiring pure + testable.
 *
 * Strictly best-effort: recall is timeout-bounded and swallows errors upstream, and
 * an empty recall yields an empty block (no-op) — it NEVER blocks or changes a build
 * when memory is unavailable.
 */

/**
 * Format recalled prior-build learnings into a system-prompt block. Empty input →
 * empty string (the caller concatenates it, so a no-op is safe). We frame it as
 * GUIDANCE from prior successful builds, not a spec, so the model treats it as a
 * prior rather than a constraint (a stale/irrelevant memory must not derail a build).
 */
export function formatRagContext(recalled: string): string {
  const text = (recalled || '').trim()
  if (!text) return ''
  // Cap the injected size so a large recall can't crowd out the real prompt.
  const capped = text.length > 2000 ? text.slice(0, 2000) + '…' : text
  return (
    '\n\n## PRIOR BUILD LEARNINGS (from ZeroMemory — similar past builds)\n' +
    'Use these as GUIDANCE from what worked on similar prior builds — prefer the same\n' +
    'primitives, components, and structure when they fit. They are hints, not a spec;\n' +
    'ignore anything that does not match THIS idea:\n' +
    capped +
    '\n'
  )
}

/**
 * Build the RAG block for an idea. Injected via a recall function (dependency-
 * injected so tests don't hit the network). Returns '' on any failure/empty.
 */
export async function buildRagContext(
  idea: string,
  recall: (idea: string) => Promise<string>,
): Promise<string> {
  try {
    const recalled = await recall(idea)
    return formatRagContext(recalled)
  } catch {
    return ''
  }
}
