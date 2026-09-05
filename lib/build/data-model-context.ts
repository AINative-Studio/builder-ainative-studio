/**
 * Data-model → codegen bridge (#532).
 *
 * Confirmed gap: NONE of the planning artifacts Cody generates during a build
 * (thesis, wedge, dataModel, memoryPolicy, codingStandards, …) are ever read
 * back into the real MVP code-generation prompt — the real codegen call
 * (`codegenCompositionBlock`, invoked from app/api/chat-ws/route.ts and
 * app/api/chat/route.ts) re-derives everything from scratch from the raw idea
 * string. The UI's own framing ("watch me work, each document I write appears
 * here") implies these documents drive the build; they didn't.
 *
 * Scope decision (see issue #532 discussion): a full artifact-pipeline rewire
 * is out of scope tonight — real engineering with prompt-length/cost
 * tradeoffs across 12+ artifacts. Instead this wires in the ONE artifact a
 * founder would most concretely notice staying in sync with their generated
 * app: `dataModel` (the ZeroDB schema Cody already committed to on paper).
 * Its schema is tiny — `{summary, entities:[{name, fields:[...]}]}`, 3-6
 * entities, each a handful of short field strings (see
 * lib/build/artifact-prompts.ts's `dataModel` spec) — so formatting it into a
 * short instruction block is a few hundred characters, not a meaningful
 * prompt-length or cost increase relative to the multi-KB system prompt
 * codegen already sends.
 *
 * `memoryPolicy` was the other strong candidate, but codegen already derives
 * its OWN ZeroMemory instruction independently (via `selectPrimitives`) that
 * usually agrees with the artifact in practice — wiring it in risked two
 * memory instructions in one prompt disagreeing with each other, which is a
 * worse failure mode than today's "coincidentally agrees" status quo. Left
 * unwired for now.
 */

/** The exact shape `ARTIFACT_PROMPTS.dataModel` asks the model to return
 *  (see lib/build/artifact-prompts.ts) and app-artifacts.tsx renders. */
export interface DataModelArtifact {
  summary?: string
  entities?: Array<{ name?: string; fields?: string[] }>
}

/**
 * Format the founder-reviewed data model into a compact, additive codegen
 * instruction block. Returns '' when there's nothing usable (artifact not
 * yet generated, generation failed, or malformed) — codegen must degrade to
 * today's idea-only behavior, never fail or block on a missing artifact.
 */
export function dataModelContextBlock(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return ''
  const model = raw as DataModelArtifact
  const entities = Array.isArray(model.entities) ? model.entities : []
  const lines: string[] = []
  for (const e of entities) {
    const name = typeof e?.name === 'string' ? e.name.trim() : ''
    if (!name) continue
    const fields = Array.isArray(e.fields)
      ? e.fields.filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
      : []
    lines.push(fields.length ? `- ${name}: ${fields.join(', ')}` : `- ${name}`)
  }
  if (lines.length === 0) return ''

  const summary = typeof model.summary === 'string' && model.summary.trim() ? model.summary.trim() : ''
  return (
    `\n\n## USE THIS DATA MODEL (already reviewed by the founder — keep the generated app's schema/tables/state consistent with it)\n\n` +
    (summary ? `${summary}\n\n` : '') +
    lines.join('\n') +
    `\n\nUse these entity and field names (or the closest natural code equivalent) for the app's data — don't invent an unrelated schema.`
  )
}
