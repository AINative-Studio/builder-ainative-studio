/**
 * Guest → real-account migration, client side (#49).
 *
 * A founder can build a company while anonymous (guest session); their
 * in-progress build state is persisted to localStorage keyed by company slug
 * (`ainative_build_<slug>`, see build-context) and the company is registered in
 * the server app-registry with no owner. When they register or log in, we must
 * re-key that work to the real account so it isn't lost.
 *
 * This module collects every in-progress company slug known to the browser and
 * hands them to POST /api/build/migrate, which stamps the SERVER-verified session
 * email as the owner (the email is NEVER sent from the client). Best-effort: a
 * failure here must never block the sign-in flow, so callers ignore rejections.
 */

const LS_PREFIX = 'ainative_build_'

/**
 * Collect the company slugs this browser has in-progress build state for:
 * every `ainative_build_<slug>` localStorage key, plus the currently-active
 * company slug (appSub) if given. De-duplicated, empties dropped.
 */
export function collectGuestCompanySlugs(currentSlug?: string): string[] {
  const slugs = new Set<string>()
  const cur = (currentSlug || '').trim()
  if (cur) slugs.add(cur)

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i)
        if (key && key.startsWith(LS_PREFIX)) {
          const slug = key.slice(LS_PREFIX.length).trim()
          if (slug) slugs.add(slug)
        }
      }
    }
  } catch {
    /* localStorage unavailable (private mode / SSR) — fall back to currentSlug */
  }

  return Array.from(slugs)
}

/**
 * Migrate the guest's in-progress companies to the now-authenticated account.
 * Resolves to the server's { migrated, skipped } summary, or a null-ish result
 * on any failure. NEVER throws — the caller runs this after a successful sign-in
 * and must not let a migration hiccup surface as an auth error.
 */
export async function migrateGuestWork(
  currentSlug?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ migrated: string[]; skipped: string[] } | null> {
  const slugs = collectGuestCompanySlugs(currentSlug)
  if (slugs.length === 0) return { migrated: [], skipped: [] }

  try {
    const res = await fetchImpl('/api/build/migrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slugs }),
    })
    if (!res.ok) return null
    const data = await res.json().catch(() => null)
    if (!data || data.ok === false) return null
    return {
      migrated: Array.isArray(data.migrated) ? data.migrated : [],
      skipped: Array.isArray(data.skipped) ? data.skipped : [],
    }
  } catch {
    return null
  }
}
