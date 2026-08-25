/**
 * Builder profile (#57) — validation + persistence for the editable Account →
 * Settings form (full name, email, optional social handle, content language),
 * persisted to the REAL AINative account.
 *
 * Core contract (verified against the live OpenAPI spec):
 *   - identity name  → PUT  /api/v1/auth/me/profile  { full_name }
 *   - free-form prefs → GET/PATCH /api/v1/users/me/preferences (shallow-merged
 *                       key/value blob) — the durable home for the builder's own
 *                       settings: content_language, social, and a founder-set
 *                       contact email.
 *   - identity read  → GET  /api/v1/auth/me  { full_name, email, ... }
 *
 * Note on email: core exposes NO self-service change of the *login* email
 * (that needs a verification flow it doesn't surface here), so the login email
 * stays authoritative. We persist the founder's chosen contact email into
 * preferences (contact_email) and surface it in the form — honest about what
 * actually changes.
 *
 * validateProfileInput is pure (no I/O) so it's trivially unit-testable.
 */

import { ainativeFetch } from '@/lib/ainative/client'
import { AINativeApiError } from '@/lib/ainative/types'
import { normalizeLanguage, DEFAULT_CONTENT_LANGUAGE } from '@/lib/build/content-language'

/** The editable profile as the client submits it and the account stores it. */
export interface ProfileInput {
  fullName: string
  email: string
  /** Optional social handle (Twitter/X etc.). '' or undefined = none. */
  social?: string
  /** Content-language code (see content-language.ts). Normalized on the way in. */
  contentLanguage: string
}

/** The validated, normalized profile that is safe to persist. */
export interface NormalizedProfile {
  fullName: string
  email: string
  social: string
  contentLanguage: string
}

export interface ValidationResult {
  ok: boolean
  /** Present when ok — the cleaned values to persist. */
  value?: NormalizedProfile
  /** Present when !ok — field → human-readable message. */
  errors?: Record<string, string>
}

// Conservative bounds so a hostile body can't store megabytes on the account.
const MAX_NAME = 120
const MAX_EMAIL = 254 // RFC 5321 practical max
const MAX_SOCIAL = 64

// Pragmatic email shape check (not full RFC — core is the hard validator).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// A social handle: letters, digits, underscore, dot, hyphen; optional leading @.
const SOCIAL_RE = /^@?[A-Za-z0-9_.-]{1,64}$/

/**
 * Validate + normalize a submitted profile. Pure (no I/O). Trims strings, strips
 * a leading '@' from the social handle for canonical storage, and normalizes the
 * content language to a supported code. Returns field-level errors when invalid.
 */
export function validateProfileInput(input: unknown): ValidationResult {
  const errors: Record<string, string> = {}
  const i = (input ?? {}) as Record<string, unknown>

  const fullName = typeof i.fullName === 'string' ? i.fullName.trim() : ''
  const email = typeof i.email === 'string' ? i.email.trim() : ''
  const socialRaw = typeof i.social === 'string' ? i.social.trim() : ''

  if (!fullName) {
    errors.fullName = 'Full name is required.'
  } else if (fullName.length > MAX_NAME) {
    errors.fullName = `Full name must be ${MAX_NAME} characters or fewer.`
  }

  if (!email) {
    errors.email = 'Email is required.'
  } else if (email.length > MAX_EMAIL || !EMAIL_RE.test(email)) {
    errors.email = 'Enter a valid email address.'
  }

  // Social is optional; only validate when provided.
  let social = ''
  if (socialRaw) {
    if (socialRaw.length > MAX_SOCIAL + 1 || !SOCIAL_RE.test(socialRaw)) {
      errors.social = 'Handle may use letters, numbers, "_", ".", "-" (optionally starting with @).'
    } else {
      social = socialRaw.replace(/^@+/, '') // canonical: store without leading @
    }
  }

  // Language always resolves to a supported code (never an error — worst case default).
  const contentLanguage = normalizeLanguage(i.contentLanguage ?? DEFAULT_CONTENT_LANGUAGE)

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, value: { fullName, email, social, contentLanguage } }
}

/** Subset of core GET /api/v1/auth/me we read. Extra fields are tolerated. */
interface CoreMe {
  email?: string
  full_name?: string
  username?: string
}

/** Core GET /api/v1/users/me/preferences response: the full free-form blob. */
interface CorePreferences {
  preferences?: Record<string, unknown> | null
}

/**
 * Build the builder profile from core identity (/auth/me) + the free-form
 * preferences blob. The founder-set contact email (if any) takes precedence over
 * the login email for display; social + content language come from preferences.
 */
export function profileFromCore(
  me: CoreMe | null | undefined,
  prefsBlob: Record<string, unknown> | null | undefined,
): NormalizedProfile {
  const prefs = (prefsBlob && typeof prefsBlob === 'object' ? prefsBlob : {}) as Record<string, unknown>
  const loginEmail = typeof me?.email === 'string' ? me.email : ''
  const contactEmail = typeof prefs.contact_email === 'string' ? prefs.contact_email : ''
  return {
    fullName: typeof me?.full_name === 'string' && me.full_name ? me.full_name : (me?.username || ''),
    email: contactEmail || loginEmail,
    social: typeof prefs.social === 'string' ? prefs.social : '',
    contentLanguage: normalizeLanguage(prefs.content_language ?? DEFAULT_CONTENT_LANGUAGE),
  }
}

/** Load the signed-in user's profile from the real AINative account. */
export async function loadCoreProfile(accessToken: string): Promise<NormalizedProfile> {
  if (!accessToken) throw new AINativeApiError('Missing AINative access token', 401)
  // Identity is required; the free-form preferences read is best-effort (a prefs
  // outage should still let the founder see + edit their name/email).
  const me = await ainativeFetch<CoreMe>('/api/v1/auth/me', accessToken, { method: 'GET' })
  let prefs: Record<string, unknown> = {}
  try {
    const res = await ainativeFetch<CorePreferences>('/api/v1/users/me/preferences', accessToken, { method: 'GET' })
    if (res?.preferences && typeof res.preferences === 'object') prefs = res.preferences
  } catch {
    /* best-effort — fall back to identity-only profile */
  }
  return profileFromCore(me, prefs)
}

/**
 * Persist a validated profile to the real AINative account:
 *   - PUT  /api/v1/auth/me/profile     → { full_name }
 *   - PATCH /api/v1/users/me/preferences → { content_language, social, contact_email }
 *     (shallow-merged server-side, so unrelated preference keys are preserved).
 *
 * Returns the normalized profile as persisted. Throws AINativeApiError on failure
 * so the route can map status faithfully.
 */
export async function updateCoreProfile(
  accessToken: string,
  profile: NormalizedProfile,
): Promise<NormalizedProfile> {
  if (!accessToken) throw new AINativeApiError('Missing AINative access token', 401)

  // Identity name → the profile endpoint.
  await ainativeFetch('/api/v1/auth/me/profile', accessToken, {
    method: 'PUT',
    body: { full_name: profile.fullName },
  })

  // Builder settings → the free-form preferences blob (shallow-merged by core, so
  // we send only our keys and never clobber unrelated ones).
  await ainativeFetch('/api/v1/users/me/preferences', accessToken, {
    method: 'PATCH',
    body: {
      content_language: profile.contentLanguage,
      social: profile.social,
      contact_email: profile.email,
    },
  })

  return profile
}
