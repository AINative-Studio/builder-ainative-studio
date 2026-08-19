/** The five acts, shown in the persistent act-bar (03-FLOW.md). */
export const ACT_LABELS = ['Idea', 'Build MVP', 'Launch', 'Company', 'Live'] as const
export type ActLabel = (typeof ACT_LABELS)[number]
