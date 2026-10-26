/**
 * #1545 — pure, testable logic for the Gitea org-per-workspace migration
 * (scripts/backfill-gitea-org-per-workspace.ts).
 *
 * Split out of the CLI for the same reason #1013's
 * backfill-zerodb-keys-args.ts was: the CLI itself runs `main()` on import
 * and makes real network calls, which makes it untestable in place — and
 * this is exactly the code path where a silent "helpful" fallback is most
 * expensive (see resolveFounderWorkspaceId's own doc comment).
 */

/**
 * Resolve a founder's REAL workspace id from their email. BLOCKED on
 * builder#1555 (no core-side service-callable email->workspace lookup
 * exists yet) — returns null unconditionally for now, which the CLI reports
 * as `skipped_unresolvable_workspace` rather than guessing or falling back
 * to the already-known-untrustworthy stored `AppEntry.workspaceId` (that
 * field is a separate instance of the exact same #1543 bug, on the ZeroDB-
 * registry side — never read it as ground truth here).
 *
 * Swap this body for the real admin call once #1555 lands. Deliberately its
 * own exported function (not inlined into the CLI's main loop) so both the
 * eventual real implementation and a unit test asserting current behavior
 * can target it directly.
 */
export async function resolveFounderWorkspaceId(_ownerEmail: string): Promise<string | null> {
  return null
}
