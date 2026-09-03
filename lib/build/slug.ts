/**
 * Shared slug derivation (#478/#479) — the SAME normalization `/api/build/brand`
 * uses to check name uniqueness and `/api/build/name-available` (#479) uses for
 * the founder's manual-rename advisory check. Both must agree on what slug a
 * given name produces, or the advisory check could say "available" for a name
 * that collides once actually registered.
 */
export function toSlug(name: string): string {
  const s = (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/g, '')
  return s || 'app'
}
