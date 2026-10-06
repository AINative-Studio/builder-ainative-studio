/**
 * Kickoff question sets (#E3.2/#E3.3) — exact wording and feed-targets from
 * the backlog doc's own tables, verbatim.
 */
export interface KickoffQuestion {
  id: string
  text: string
  suggestions: string[]
}

export const COMPANY_NEW_BUSINESS_QUESTIONS: KickoffQuestion[] = [
  { id: 'who', text: 'Who would you like to help?', suggestions: ['People in my area', 'Other businesses', 'A specific group'] },
  { id: 'problem', text: "What problem do they have that you'd fix?", suggestions: [] },
  { id: 'pricing', text: 'How would you like to get paid?', suggestions: ['Monthly subscription', 'Per job', 'One-time purchase'] },
]

export const COMPANY_GROW_BUSINESS_QUESTIONS: KickoffQuestion[] = [
  { id: 'today', text: 'What does your business do today, and where?', suggestions: [] },
  { id: 'blocker', text: "What's holding the business back most?", suggestions: ['Finding customers', 'Booking and scheduling', 'Getting paid', 'Too much admin'] },
  { id: 'customers', text: 'Who are your customers today?', suggestions: ['Homeowners', 'Other businesses', 'Both'] },
]

export const APP_KICKOFF_QUESTIONS: KickoffQuestion[] = [
  { id: 'help', text: 'What should the app help people do?', suggestions: [] },
  { id: 'who', text: 'Who will use it?', suggestions: ['My customers', 'My team', 'Just me'] },
  { id: 'track', text: 'What should it keep track of?', suggestions: ['Customers and contacts', 'Bookings', 'Orders and payments', 'Files and photos'] },
]

export function getKickoffQuestions(track: 'app' | 'company', isGrowth: boolean): KickoffQuestion[] {
  if (track === 'app') return APP_KICKOFF_QUESTIONS
  return isGrowth ? COMPANY_GROW_BUSINESS_QUESTIONS : COMPANY_NEW_BUSINESS_QUESTIONS
}
