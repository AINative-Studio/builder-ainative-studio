/**
 * Feedback capture logic (#332 DATA-1) — pure, storage-agnostic.
 *
 * Powers the FeedbackPulse ("Was this what you asked for?") shown after every
 * generation. This module owns everything testable: the once-per-generation
 * key derivation, the has-rated/mark-rated localStorage logic, and building
 * the RLHF payload that POSTs to /api/rlhf/submit-feedback.
 *
 * The API contract (app/api/rlhf/submit-feedback/route.ts → submitRLHFFeedback
 * in lib/zerodb-store.ts) accepts and persists:
 *   chatId (required), rating (1–5; 1 = thumbs down, 5 = thumbs up),
 *   feedbackText, prompt, model.
 * That is the maximal honest set — so context that must survive for training
 * (track / view / slug / surface) rides in the prompt as a machine-readable
 * suffix appended to the founder's idea.
 *
 * Pure and storage-agnostic like first-run.ts: callers pass any storage-like
 * object (browser localStorage, or an in-memory stub in tests). Every storage
 * call is wrapped so private mode / quota errors are non-fatal.
 */

/** Minimal storage surface — satisfied by window.localStorage and test stubs. */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** localStorage key prefix; one entry per rated generation. */
export const FEEDBACK_KEY_PREFIX = 'ainative-feedback-rated'

/** API contract rating values (see lib/zerodb-store.ts: 1 = down, 5 = up). */
export const RATING_UP = 5
export const RATING_DOWN = 1

/** Where the pulse rendered — part of the training context. */
export type FeedbackSurface = 'preview' | 'live'

/** Everything the workspace knows about the generation being rated. */
export interface FeedbackContext {
  /** The generation's chatId (state.appChatId / useRealPreview chatId). */
  chatId?: string
  /** The company slug (state.appSub) — fallback generation identifier. */
  slug?: string
  /** The founder's raw idea — the original prompt that drove generation. */
  idea?: string
  /** 'app' | 'company' track. */
  track?: string
  /** The artifact view active when rated (e.g. 'preview'). */
  view?: string
  /** Which screen surfaced the pulse. */
  surface: FeedbackSurface
  /** Model identifier when known (optional; API stores it). */
  model?: string
}

/** Wire payload for POST /api/rlhf/submit-feedback (exact route contract). */
export interface FeedbackPayload {
  chatId: string
  rating: number
  feedbackText: string
  prompt: string
  model: string
}

/**
 * The identity of ONE generation: chatId when we have it (a real generation
 * id), else the slug (stable per company build). Null when neither exists —
 * an unidentifiable generation cannot be rated once-only, so the pulse
 * doesn't render at all.
 */
export function generationId(ctx: Pick<FeedbackContext, 'chatId' | 'slug'>): string | null {
  const chatId = (ctx.chatId || '').trim()
  if (chatId) return chatId
  const slug = (ctx.slug || '').trim()
  if (slug) return `slug:${slug}`
  return null
}

/** Storage key for a generation's rated-flag; null when unidentifiable. */
export function feedbackKey(ctx: Pick<FeedbackContext, 'chatId' | 'slug'>): string | null {
  const id = generationId(ctx)
  return id ? `${FEEDBACK_KEY_PREFIX}:${id}` : null
}

/**
 * True when this generation has already been rated on this browser.
 * Absent/broken storage says NOT rated — a duplicate row in the RLHF table is
 * harmless; silently losing a founder's signal is not.
 */
export function hasRated(
  store: StorageLike | null | undefined,
  ctx: Pick<FeedbackContext, 'chatId' | 'slug'>,
): boolean {
  const key = feedbackKey(ctx)
  if (!key || !store) return false
  try {
    return store.getItem(key) !== null
  } catch {
    return false
  }
}

/** Record that this generation was rated so the pulse never re-asks. */
export function markRated(
  store: StorageLike | null | undefined,
  ctx: Pick<FeedbackContext, 'chatId' | 'slug'>,
): void {
  const key = feedbackKey(ctx)
  if (!key || !store) return
  try {
    store.setItem(key, new Date().toISOString())
  } catch {
    /* private mode / quota — non-fatal; state keeps it collapsed in-session */
  }
}

/**
 * The training prompt: the founder's idea first (the true original prompt),
 * then a machine-readable context line so the stored row is trainable —
 * track, view, slug, surface all survive inside the one free-text field the
 * API persists.
 */
export function composeTrainingPrompt(ctx: FeedbackContext): string {
  const idea = (ctx.idea || '').trim()
  const tags = [
    ctx.track ? `track=${ctx.track}` : '',
    ctx.view ? `view=${ctx.view}` : '',
    ctx.slug ? `slug=${ctx.slug}` : '',
    `surface=${ctx.surface}`,
  ].filter(Boolean)
  const contextLine = `[builder ${tags.join(' ')}]`
  return idea ? `${idea}\n${contextLine}` : contextLine
}

/**
 * Build the exact POST body for /api/rlhf/submit-feedback.
 * Returns null when the generation is unidentifiable (no chatId, no slug) —
 * the route 400s without a chatId, so there is nothing honest to send.
 */
export function buildFeedbackPayload(
  ctx: FeedbackContext,
  positive: boolean,
  feedbackText = '',
): FeedbackPayload | null {
  const id = generationId(ctx)
  if (!id) return null
  return {
    chatId: id,
    rating: positive ? RATING_UP : RATING_DOWN,
    feedbackText: feedbackText.trim(),
    prompt: composeTrainingPrompt(ctx),
    model: ctx.model || '',
  }
}

/**
 * Should the pulse render at all? Only for an identifiable generation that
 * hasn't been rated on this browser. Pure — the component calls this once on
 * mount and keeps the rest in local state.
 */
export function shouldShowPulse(
  store: StorageLike | null | undefined,
  ctx: Pick<FeedbackContext, 'chatId' | 'slug'>,
): boolean {
  if (!generationId(ctx)) return false
  return !hasRated(store, ctx)
}

/** Browser localStorage when available, else null (SSR / private mode). */
export function browserStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}
