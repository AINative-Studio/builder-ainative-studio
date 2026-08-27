/**
 * Per-artifact review / edit / regenerate — pure logic (GR-16, #329).
 *
 * Every generated build artifact must be reviewable: the founder can either
 * REGENERATE it (optionally steering with feedback that is appended to the
 * generation prompt for that view) or EDIT its raw content inline. The React
 * wiring lives in components/build/ArtifactFrame.tsx; everything testable
 * (prompt composition, serialize/apply round-trip, prior-context collection)
 * lives here.
 */

/** Max characters of founder feedback forwarded into the prompt. */
export const FEEDBACK_MAX_CHARS = 2000

/**
 * Compose the prompt block for founder feedback on a previous draft. Returned
 * string is appended to the artifact's user prompt by /api/build/artifact.
 * Blank / whitespace-only feedback → '' (regeneration without steering).
 */
export function feedbackInstruction(feedback: string | null | undefined): string {
  const fb = (feedback ?? '').trim()
  if (!fb) return ''
  const clipped = fb.slice(0, FEEDBACK_MAX_CHARS)
  return (
    '\n\nThe founder reviewed the previous draft of this artifact and asked for changes. ' +
    'Apply this feedback while keeping the rest consistent with the idea and prior artifacts:\n' +
    `"""${clipped}"""`
  )
}

/**
 * Collect prior generated artifacts as regeneration context — every generated
 * view in the track sequence EXCEPT the one being regenerated (feeding the old
 * draft back in would anchor the model on the content being replaced).
 */
export function collectPrior(
  seq: readonly string[],
  generated: Record<string, unknown>,
  excludeView: string,
): Record<string, unknown> {
  const prior: Record<string, unknown> = {}
  for (const v of seq) {
    if (v === excludeView) continue
    if (generated[v] !== undefined && generated[v] !== null) prior[v] = generated[v]
  }
  return prior
}

/** Render an artifact's raw generated content as editable text (textarea value). */
export function serializeArtifact(content: unknown): string {
  if (content === undefined || content === null) return ''
  if (typeof content === 'string') return content
  try {
    return JSON.stringify(content, null, 2)
  } catch {
    return String(content)
  }
}

export type EditResult =
  | { ok: true; content: unknown }
  | { ok: false; error: string }

/**
 * Apply an inline edit to an artifact's raw content.
 *
 * - Empty edits are rejected (an artifact can't be blanked from the editor).
 * - When the original content is structured (object/array — every generated
 *   artifact is), the edited text must still parse as JSON so the artifact body
 *   keeps rendering; a parse failure returns an error instead of corrupting the
 *   generated map.
 * - When the original is a plain string, the edited text is stored as-is.
 */
export function applyEdit(original: unknown, text: string): EditResult {
  const trimmed = text.trim()
  if (!trimmed) {
    return { ok: false, error: 'The artifact cannot be empty.' }
  }
  if (original !== null && typeof original === 'object') {
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed === null || typeof parsed !== 'object') {
        return { ok: false, error: 'This artifact is structured — the edit must stay a JSON object.' }
      }
      return { ok: true, content: parsed }
    } catch {
      return { ok: false, error: 'The edit is not valid JSON — fix the syntax and save again.' }
    }
  }
  return { ok: true, content: trimmed }
}
