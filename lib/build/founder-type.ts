/**
 * Founder-type assessment (#1311) — classifies a founder's working style so
 * Cody can adapt how it works with them. No existing personality/working-
 * style classification exists anywhere in Builder today.
 *
 * Deliberately a SMALL first cut per the issue's own note that the full
 * vision needs its own design pass: 5 fixed questions, a plain deterministic
 * (NOT an LLM call) scoring function, and exactly ONE bounded behavioral
 * hook (wired in lib/build/state.ts's SET_FOUNDER_TYPE case) — an
 * 'architect'-type founder gets one extra review step before a build
 * proceeds; 'hustler'/'operator' do not. That is the only place founderType
 * changes behavior; it is not threaded through the rest of the codebase.
 *
 * Labels (reasonable, documented small set):
 *   - 'architect': wants to review/approve decisions before Cody proceeds.
 *   - 'hustler':   wants Cody to just ship and report back.
 *   - 'operator':  wants steady, predictable progress — the safe middle
 *                  default when answers don't clearly point either way.
 */

export type FounderType = 'architect' | 'hustler' | 'operator'

export interface FounderTypeOption {
  value: string
  label: string
  type: FounderType
}

export interface FounderTypeQuestion {
  id: string
  text: string
  options: FounderTypeOption[]
}

/** answerId -> the FounderType the chosen option was tagged with. */
export type FounderTypeAnswers = Partial<Record<string, FounderType>>

export const FOUNDER_TYPE_QUESTIONS: FounderTypeQuestion[] = [
  {
    id: 'pace',
    text: 'When Cody is building, how do you want it to move?',
    options: [
      { value: 'fast', label: 'Fast — ship first, I’ll review after', type: 'hustler' },
      { value: 'checked', label: 'Steady — check in at clear milestones', type: 'operator' },
      { value: 'careful', label: 'Careful — walk me through decisions as they come up', type: 'architect' },
    ],
  },
  {
    id: 'review',
    text: 'Before Cody finalizes something important (like a data model or pricing), what do you want?',
    options: [
      { value: 'review-first', label: 'Let me review it before it\'s final', type: 'architect' },
      { value: 'tell-me', label: 'Just tell me what you decided and why', type: 'operator' },
      { value: 'surprise', label: 'Surprise me — I trust your judgment', type: 'hustler' },
    ],
  },
  {
    id: 'risk',
    text: 'How do you feel about Cody making a judgment call you might disagree with?',
    options: [
      { value: 'fine', label: 'Totally fine — fix it later if needed', type: 'hustler' },
      { value: 'prefer-ask', label: 'I\'d rather it asked first', type: 'architect' },
      { value: 'depends', label: 'Depends — ask for anything irreversible', type: 'operator' },
    ],
  },
  {
    id: 'delegation',
    text: 'How involved do you want to be day to day?',
    options: [
      { value: 'hands-off', label: 'Hands-off — just send me the result', type: 'hustler' },
      { value: 'hands-on', label: 'Hands-on — I want to shape the details', type: 'architect' },
      { value: 'periodic', label: 'Periodic check-ins work best for me', type: 'operator' },
    ],
  },
  {
    id: 'detail',
    text: 'When Cody reports back, what do you want to see?',
    options: [
      { value: 'headline', label: 'The headline — done or not done', type: 'hustler' },
      { value: 'full-detail', label: 'Full detail — show me the reasoning', type: 'architect' },
      { value: 'summary', label: 'A short summary with the key points', type: 'operator' },
    ],
  },
]

/**
 * Deterministic classification: count votes for each type across whichever
 * questions were answered, and return the type with the most votes. Ties
 * (including zero answers) resolve to 'operator' — the safe, no-extra-
 * friction default documented above.
 */
export function classifyFounderType(answers: FounderTypeAnswers): FounderType {
  const counts: Record<FounderType, number> = { architect: 0, hustler: 0, operator: 0 }
  for (const type of Object.values(answers)) {
    if (type) counts[type] += 1
  }

  const architect = counts.architect
  const hustler = counts.hustler
  const operator = counts.operator

  if (architect > hustler && architect > operator) return 'architect'
  if (hustler > architect && hustler > operator) return 'hustler'
  return 'operator'
}
