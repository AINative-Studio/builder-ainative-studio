/**
 * #1013 — argument parsing for `scripts/backfill-zerodb-keys.ts`.
 *
 * Split out of the CLI so it is a pure, testable function: the CLI itself runs
 * `main()` on import and mints real credentials, which makes it untestable in
 * place, and this is exactly the code path where a silent parse bug is most
 * expensive.
 *
 * THE BUG THIS SHAPE EXISTS TO PREVENT. The RECOMMENDED first real-world use of
 * the sweep is a single-company canary:
 *
 *   npx tsx scripts/backfill-zerodb-keys.ts --only agentive --apply
 *
 * The earlier parser skipped a `--only` whose next argv entry was missing or
 * itself started with `--`:
 *
 *   const v = argv[i + 1]
 *   if (!v || v.startsWith('--')) continue    // <- silently drops the scope
 *
 * So `--only --apply` (that canary with the slug dropped — and `--apply` does
 * directly follow `--only` there) produced `onlySlugs: []`, which the sweep
 * reads as NO SCOPE RESTRICTION, with `apply` still true. The intended
 * one-company canary silently became a full-registry run minting real
 * credentials against every affected customer project, and nothing in the
 * output said the scope had widened.
 *
 * So: a `--only` with no usable value is a HARD ERROR. Widening the blast
 * radius is never the right interpretation of a malformed argument — failing
 * loudly costs one re-typed command, and "whole registry" must be something an
 * operator asked for explicitly by omitting `--only` altogether.
 */

export class BackfillArgsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackfillArgsError'
  }
}

export interface BackfillArgs {
  /** True only when `--apply` was passed. Dry run is the default. */
  apply: boolean
  /** Explicit company scope. Empty ONLY when no `--only` was passed at all. */
  onlySlugs: string[]
}

const USAGE =
  'Usage: --only <slug>[,<slug>...] [--apply]   (omit --only entirely to sweep the whole registry)'

/**
 * Parse the backfill CLI's arguments.
 *
 * @param argv argument list WITHOUT the node/script entries (i.e. `process.argv.slice(2)`).
 * @throws BackfillArgsError when `--only` is present but has no usable slug —
 *   never falls back to an unscoped run.
 */
export function parseBackfillArgs(argv: string[]): BackfillArgs {
  const apply = argv.includes('--apply')
  const onlySlugs: string[] = []

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--only') continue

    const raw = argv[i + 1]

    // Missing entirely (`--only` last), or the next token is another flag
    // (`--only --apply`). A leading `--` is what makes it a flag; a slug may
    // still CONTAIN dashes, e.g. `my-real-company`.
    if (raw === undefined || raw.startsWith('--')) {
      throw new BackfillArgsError(
        `--only was given with no company slug (next argument: ${
          raw === undefined ? '(none)' : `"${raw}"`
        }).\n` +
          '  Refusing to run: an empty --only would silently widen the scope from one company\n' +
          '  to the ENTIRE registry, which with --apply mints real credentials against every\n' +
          `  affected customer project.\n  ${USAGE}`,
      )
    }

    const slugs = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    // A value that is only commas/whitespace (`--only ,`) splits down to
    // nothing — the same silent widening by another route.
    if (!slugs.length) {
      throw new BackfillArgsError(
        `--only was given the value "${raw}", which contains no company slug.\n` +
          '  Refusing to run rather than silently sweeping the whole registry.\n' +
          `  ${USAGE}`,
      )
    }

    onlySlugs.push(...slugs)
  }

  return { apply, onlySlugs }
}
