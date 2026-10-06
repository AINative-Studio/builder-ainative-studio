/**
 * Per-artifact guided questions (#BLD-06.3). Targets the real "ASSUMPTION ·
 * TBD" markers a generated artifact leaves when the idea alone didn't
 * answer something -- authored for the steps where that gap is most
 * visible today; other views return [] honestly rather than a guessed
 * generic question set.
 */
import { FEEDBACK_MAX_CHARS } from '@/lib/build/artifact-edit'

export interface CodyQuestion {
  id: string
  text: string
  suggestions: string[]
  allowFreeText: true
}

const QUESTION_SETS: Record<string, CodyQuestion[]> = {
  thesis: [
    {
      id: 'who',
      text: 'Who feels this problem the most?',
      suggestions: ['People in my area', 'Other businesses', 'A specific group'],
      allowFreeText: true,
    },
    {
      id: 'problem',
      text: "What's the problem you'd fix for them?",
      suggestions: ['Finding customers', 'Getting paid', 'Too much admin'],
      allowFreeText: true,
    },
  ],
  wedge: [
    {
      id: 'first-customers',
      text: 'How would you like to reach your first customers?',
      suggestions: ['Word of mouth', 'Social media', 'Local ads', 'Partnerships'],
      allowFreeText: true,
    },
  ],
  businessmodel: [
    {
      id: 'pricing',
      text: 'How would you like to get paid?',
      suggestions: ['Monthly subscription', 'Per job', 'One-time purchase'],
      allowFreeText: true,
    },
  ],
}

export function getQuestionsForView(view: string): CodyQuestion[] {
  return QUESTION_SETS[view] || []
}

const NOT_SURE = 'not sure yet'

export function composeFeedbackFromAnswers(questions: CodyQuestion[], answers: Record<string, string>): string {
  const lines: string[] = []
  for (const q of questions) {
    const a = (answers[q.id] || '').trim()
    if (!a || a.toLowerCase() === NOT_SURE) continue
    lines.push(`Q: ${q.text}\nA: ${a}`)
  }
  if (!lines.length) return ''
  let body = lines.join('\n\n')
  const wrap = (s: string) =>
    `\n\nThe founder answered Cody's questions about this step. Apply these answers while keeping the rest consistent with the idea and prior artifacts:\n"""${s}"""`
  while (wrap(body).length > FEEDBACK_MAX_CHARS && lines.length > 0) {
    lines.pop()
    body = lines.join('\n\n')
  }
  return lines.length ? wrap(body) : ''
}
