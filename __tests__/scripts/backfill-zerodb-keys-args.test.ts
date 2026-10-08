import { describe, it, expect } from 'vitest'

import { parseBackfillArgs, BackfillArgsError } from '@/scripts/backfill-zerodb-keys-args'

/**
 * #1013 — argument parsing for the ZeroDB key backfill CLI (code-review MEDIUM
 * finding).
 *
 * WHY THIS IS WORTH ITS OWN TEST FILE. The RECOMMENDED first real-world use of
 * this script is a single-company canary:
 *
 *   npx tsx scripts/backfill-zerodb-keys.ts --only agentive --apply
 *
 * The original parser skipped a `--only` whose next argv entry was missing or
 * itself looked like a flag (`if (!v || v.startsWith('--')) continue`). So
 * `--only --apply` — a plausible typo of that exact canary command, since
 * `--apply` directly follows `--only` and starts with `--` — silently produced
 * `onlySlugs: []`, which the sweep reads as NO SCOPE RESTRICTION. The intended
 * one-company canary became a full-registry run against ~17 real customer
 * projects, with `apply` still true and nothing in the output saying the scope
 * had widened.
 *
 * A dropped argument must therefore be a HARD ERROR, never a silent widening:
 * failing loudly costs one re-typed command, while widening mints real
 * credentials against every affected company in one shot.
 */

describe('parseBackfillArgs — a dropped --only value must never widen the scope', () => {
  it('ERRORS on `--only --apply` instead of silently sweeping the whole registry', () => {
    // The exact proven footgun: a typo of `--only agentive --apply`.
    expect(() => parseBackfillArgs(['--only', '--apply'])).toThrow(BackfillArgsError)
    expect(() => parseBackfillArgs(['--only', '--apply'])).toThrow(/--only/)
  })

  it('ERRORS when --only is the last argv entry with no value after it', () => {
    expect(() => parseBackfillArgs(['--apply', '--only'])).toThrow(BackfillArgsError)
  })

  it('ERRORS on `--only` followed by a value that is only commas/whitespace', () => {
    // `--only ,` or `--only " "` would also split down to an empty list, which
    // is the same silent full-registry widening by another route.
    expect(() => parseBackfillArgs(['--only', ','])).toThrow(BackfillArgsError)
    expect(() => parseBackfillArgs(['--only', '  '])).toThrow(BackfillArgsError)
  })

  it('names the flag and shows the correct usage, so the fix is obvious from the error alone', () => {
    let msg = ''
    try {
      parseBackfillArgs(['--only', '--apply'])
    } catch (e: any) {
      msg = String(e?.message || '')
    }
    expect(msg).toContain('--only')
    expect(msg).toContain('--apply')
    expect(msg.toLowerCase()).toContain('slug')
  })
})

describe('parseBackfillArgs — valid invocations still behave exactly as before', () => {
  it('parses the recommended canary `--only agentive --apply` as one company, apply on', () => {
    const r = parseBackfillArgs(['--only', 'agentive', '--apply'])
    expect(r.onlySlugs).toEqual(['agentive'])
    expect(r.apply).toBe(true)
  })

  it('parses a dry run with no flags: whole registry, apply OFF (the safe default)', () => {
    const r = parseBackfillArgs([])
    expect(r.onlySlugs).toEqual([])
    expect(r.apply).toBe(false)
  })

  it('parses a deliberate whole-registry apply run (`--apply` with no --only)', () => {
    const r = parseBackfillArgs(['--apply'])
    expect(r.onlySlugs).toEqual([])
    expect(r.apply).toBe(true)
  })

  it('still supports a comma-separated list and trims the entries', () => {
    const r = parseBackfillArgs(['--only', 'agentive, castlo ,foo'])
    expect(r.onlySlugs).toEqual(['agentive', 'castlo', 'foo'])
  })

  it('still supports a repeated --only flag', () => {
    const r = parseBackfillArgs(['--only', 'agentive', '--only', 'castlo', '--apply'])
    expect(r.onlySlugs).toEqual(['agentive', 'castlo'])
    expect(r.apply).toBe(true)
  })

  it('accepts a slug that merely CONTAINS dashes — only a leading `--` is a flag', () => {
    const r = parseBackfillArgs(['--only', 'my-real-company', '--apply'])
    expect(r.onlySlugs).toEqual(['my-real-company'])
  })
})
