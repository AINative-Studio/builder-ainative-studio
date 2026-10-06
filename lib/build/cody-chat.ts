/**
 * Cody's plain-language step summaries and questions (#BLD-06.2/06.3),
 * built on the SAME provider chain /api/build/artifact already uses --
 * never a new model/endpoint.
 */
import { getClaudeCompletion } from '@/lib/build/claude-completion'

export interface SummaryResult {
  ok: boolean
  summary?: string
  reason?: string
}

const SUMMARY_SYSTEM_PROMPT = `You explain a single step of a founder's business or product plan in plain, everyday language.
Rules:
- 3 sentences or fewer.
- No jargon: never use the words "wedge", "PRD", "data model", "memory policy", "AI-native", "swarm", or "provision".
- Say what this step is and why it matters to the founder, not how it was generated.`

export async function summarizeArtifactStep(
  view: string,
  track: 'app' | 'company',
  content: unknown,
): Promise<SummaryResult> {
  const completion = getClaudeCompletion()
  if (!completion) return { ok: false, reason: 'not_configured' }
  try {
    const res = await completion.client.messages.create({
      model: completion.model,
      max_tokens: 300,
      system: SUMMARY_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Track: ${track}. Step: ${view}. Generated content:\n${JSON.stringify(content).slice(0, 4000)}`,
      }],
    })
    const text = res?.content?.find((b: { type: string }) => b.type === 'text')?.text
    if (!text) return { ok: false, reason: 'empty_response' }
    return { ok: true, summary: String(text).trim() }
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e).slice(0, 160) }
  }
}
