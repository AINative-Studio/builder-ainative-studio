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

// #1306 — id of the optional existing-site-URL question appended below.
// Exported so KickoffQuestions.tsx can recognize this specific answer and
// trigger the real fetch+assess pass instead of treating it as a plain
// free-text answer.
export const SITE_URL_QUESTION_ID = 'existing-site-url'

export const COMPANY_GROW_BUSINESS_QUESTIONS: KickoffQuestion[] = [
  { id: 'today', text: 'What does your business do today, and where?', suggestions: [] },
  { id: 'blocker', text: "What's holding the business back most?", suggestions: ['Finding customers', 'Booking and scheduling', 'Getting paid', 'Too much admin'] },
  { id: 'customers', text: 'Who are your customers today?', suggestions: ['Homeowners', 'Other businesses', 'Both'] },
  // #1306 — real, bounded scope: a growth-intent founder can tell Cody their
  // existing site so it can run a light, honest assessment on it (title/meta/
  // headings). Free text only, always skippable via "Not sure yet" like
  // every other kickoff question — never a hard gate.
  { id: SITE_URL_QUESTION_ID, text: 'Do you have an existing website? Paste the link.', suggestions: [] },
]

export const APP_KICKOFF_QUESTIONS: KickoffQuestion[] = [
  { id: 'help', text: 'What should the app help people do?', suggestions: [] },
  { id: 'who', text: 'Who will use it?', suggestions: ['My customers', 'My team', 'Just me'] },
  { id: 'track', text: 'What should it keep track of?', suggestions: ['Customers and contacts', 'Bookings', 'Orders and payments', 'Files and photos'] },
]

// #1182 — commerce-specific kickoff questions for the "Launch an online
// store" entry point on BuildStart.tsx, instead of the generic
// COMPANY_NEW_BUSINESS_QUESTIONS set. Mirrors that set's shape and length
// (3 questions) but asks what a store actually needs decided up front:
// product type (shapes catalog fields), checkout model (shapes whether
// ZeroCommerce's Customer-less guest flow is enough), and whether the
// founder wants the Sales-role CRM pairing (ZeroPipeline/ZeroInvoice) made
// explicit rather than left to BuildStart.tsx's optional role picker alone.
export const COMPANY_ECOMMERCE_QUESTIONS: KickoffQuestion[] = [
  { id: 'what-selling', text: 'What are you selling?', suggestions: ['Physical products', 'Digital products', 'Both'] },
  { id: 'checkout-model', text: 'How should checkout work?', suggestions: ['Guest checkout', 'Customer accounts', 'Both'] },
  { id: 'sales-pairing', text: 'Want a sales pipeline and invoicing alongside your store?', suggestions: ['Yes', 'Not yet'] },
]

export function getKickoffQuestions(
  track: 'app' | 'company',
  isGrowth: boolean,
  isEcommerce?: boolean,
): KickoffQuestion[] {
  if (track === 'app') return APP_KICKOFF_QUESTIONS
  if (isEcommerce) return COMPANY_ECOMMERCE_QUESTIONS
  return isGrowth ? COMPANY_GROW_BUSINESS_QUESTIONS : COMPANY_NEW_BUSINESS_QUESTIONS
}
