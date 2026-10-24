/**
 * Danger Zone (#57) — pause the company (stop the nightly loop), take its app
 * offline, or delete it, all with confirmation. Maps a founder's intent to the
 * two real state stores the builder already owns:
 *   - loop enrollment (lib/build/loop-enrollment) — 'pause' / 'resume'
 *   - app registry lifecycle (lib/build/app-registry) — 'offline' / 'delete'
 *
 * The pure `parseDangerRequest` validates + normalizes the request (including a
 * confirmation guard) with no I/O so it is trivially unit-testable. The networked
 * `applyDangerAction` performs the corresponding store write.
 */

import { setLoopEnabled } from '@/lib/build/loop-enrollment'
import { setAppLifecycle, resolveAppVerified } from '@/lib/build/app-registry'
import { releaseZeroVoiceNumber } from '@/lib/build/zerovoice'
import { deleteCustomDomain } from '@/lib/build/railway-deploy'
import { logger } from '@/lib/logger'

export type DangerAction = 'pause' | 'resume' | 'offline' | 'delete'

export interface DangerRequest {
  action: DangerAction
  companyId: string
  companyName: string
  track: 'app' | 'company'
  /** The slug used by the app registry (defaults to companyId when absent). */
  slug: string
  /** Must equal the company name (or slug) to confirm a destructive action. */
  confirm: string
}

export interface DangerParseResult {
  ok: boolean
  value?: DangerRequest
  error?: string
}

const ACTIONS: readonly DangerAction[] = ['pause', 'resume', 'offline', 'delete']

/** Destructive actions require an explicit typed confirmation from the founder. */
const REQUIRES_CONFIRM: readonly DangerAction[] = ['offline', 'delete']

/**
 * Validate + normalize a Danger Zone request. Pure (no I/O). For destructive
 * actions (offline, delete) the caller must pass a `confirm` string that matches
 * the company name or slug (case-insensitive, trimmed) — this is the server-side
 * backstop for the UI confirmation, so a stray/replayed request can't nuke a
 * company. Returns a field-level error otherwise.
 */
export function parseDangerRequest(input: unknown): DangerParseResult {
  const i = (input ?? {}) as Record<string, unknown>

  const action = i.action as DangerAction
  if (!ACTIONS.includes(action)) {
    return { ok: false, error: `unknown action: ${String(i.action)}` }
  }

  const companyId = typeof i.companyId === 'string' ? i.companyId.trim() : ''
  if (!companyId) return { ok: false, error: 'companyId is required' }

  const companyName = typeof i.companyName === 'string' ? i.companyName.trim() : ''
  const slug = typeof i.slug === 'string' && i.slug.trim() ? i.slug.trim() : companyId
  const track = i.track === 'company' ? 'company' : 'app'
  const confirm = typeof i.confirm === 'string' ? i.confirm.trim() : ''

  if (REQUIRES_CONFIRM.includes(action)) {
    const targets = [companyName, slug].map((s) => s.toLowerCase()).filter(Boolean)
    if (!confirm || !targets.includes(confirm.toLowerCase())) {
      return { ok: false, error: 'confirmation does not match the company name' }
    }
  }

  return { ok: true, value: { action, companyId, companyName, track, slug, confirm } }
}

export interface DangerOutcome {
  ok: boolean
  action: DangerAction
  /** Side-effects that actually succeeded, for an honest response to the UI. */
  loopChanged?: boolean
  lifecycleChanged?: boolean
  zerovoiceReleased?: boolean
  byoDomainReleased?: boolean
  /** Set when the registry lookup for provisioned resources (zerovoiceNumberId/
   *  byoDomainId) could not be confirmed — distinct from "nothing was
   *  provisioned." The lifecycle flip still proceeds (the founder's company
   *  still disappears from their view, as they expect), but a real phone
   *  number or domain may be left orphaned/unreleased and need a manual
   *  follow-up, rather than this looking identical to a clean "nothing to
   *  release" delete. */
  resourceReleaseUnverified?: boolean
  detail?: string
}

/**
 * Apply a parsed Danger Zone action to the real stores. Mapping:
 *   - pause   → disable the nightly loop (setLoopEnabled false)
 *   - resume  → re-enable the nightly loop (setLoopEnabled true)
 *   - offline → set app lifecycle 'offline' (kept, not served)
 *   - delete  → disable the loop, best-effort release the two provisioned
 *               resources with a confirmed real release API (ZeroVoice
 *               number, BYO domain Railway wiring — ZeroDB projects and
 *               purchased domains have NO delete endpoint anywhere in their
 *               real APIs, see #SEP-02's own research; left unreleased, not
 *               silently simulated), THEN set app lifecycle 'deleted'.
 *
 * Best-effort + honest: returns which side-effects landed. A store that isn't
 * configured returns false from its setter, surfaced as *_changed:false rather
 * than a thrown error, so the caller can report partial success truthfully. A
 * release failure must never block the lifecycle flip — a founder expects
 * "delete" to make the company disappear from their view even if a backend
 * is down.
 */
export async function applyDangerAction(req: DangerRequest, founderJwt?: string): Promise<DangerOutcome> {
  switch (req.action) {
    case 'pause': {
      const loopChanged = await setLoopEnabled(req.companyId, req.companyName, req.track, false)
      return { ok: true, action: 'pause', loopChanged }
    }
    case 'resume': {
      const loopChanged = await setLoopEnabled(req.companyId, req.companyName, req.track, true)
      return { ok: true, action: 'resume', loopChanged }
    }
    case 'offline': {
      const lifecycleChanged = await setAppLifecycle(req.slug, 'offline')
      return { ok: true, action: 'offline', lifecycleChanged }
    }
    case 'delete': {
      const loopChanged = await setLoopEnabled(req.companyId, req.companyName, req.track, false)

      let zerovoiceReleased: boolean | undefined
      let byoDomainReleased: boolean | undefined
      const { entry, verified } = await resolveAppVerified(req.slug).catch(
        () => ({ entry: null as Awaited<ReturnType<typeof resolveAppVerified>>['entry'], verified: false }),
      )
      if (!verified) {
        // Could not confirm whether this company had a provisioned ZeroVoice
        // number / BYO domain to release — must not look identical to a
        // confirmed "nothing was provisioned." The lifecycle flip below still
        // proceeds (same "must never block delete" reasoning as a release
        // call itself failing), but resourceReleaseUnverified flags that a
        // real resource may be left orphaned and need a manual follow-up.
        logger.warn('danger-zone delete: could not verify registry entry before releasing resources', {
          companyId: req.companyId, slug: req.slug,
        })
      }
      if (entry?.zerovoiceNumberId && founderJwt) {
        const released = await releaseZeroVoiceNumber(founderJwt, entry.zerovoiceNumberId)
        zerovoiceReleased = released.ok
      }
      if (entry?.byoDomainId) {
        const released = await deleteCustomDomain(entry.byoDomainId)
        byoDomainReleased = released.ok
      }

      const lifecycleChanged = await setAppLifecycle(req.slug, 'deleted')
      return {
        ok: true, action: 'delete', loopChanged, lifecycleChanged, zerovoiceReleased, byoDomainReleased,
        resourceReleaseUnverified: verified ? undefined : true,
      }
    }
    default:
      return { ok: false, action: req.action, detail: 'unhandled action' }
  }
}
