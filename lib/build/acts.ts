/** The acts, shown in the persistent act-bar (03-FLOW.md).
 *
 * Real bug (customer-reported, 2026-09-09): the App track always showed the
 * same 5 acts (Idea/Build MVP/Launch/Company/Live) even though it never has
 * a "Company" act, AND its real design-system choice (#591) was invisible
 * here entirely. Split into per-track label sets so each track's act-bar
 * matches what actually happens on it — App track surfaces the real Design
 * step; Company track is unchanged (design has no effect there, #601/#602).
 */
export const APP_ACT_LABELS = ['Idea', 'Design', 'Build MVP', 'Launch', 'Live'] as const
export const COMPANY_ACT_LABELS = ['Idea', 'Build MVP', 'Launch', 'Company', 'Live'] as const

// Back-compat export (unused after this fix, kept only if anything external
// still imports the old flat list) — mirrors the Company track's shape,
// which was the pre-fix universal default.
export const ACT_LABELS = COMPANY_ACT_LABELS
export type ActLabel = (typeof APP_ACT_LABELS)[number] | (typeof COMPANY_ACT_LABELS)[number]
