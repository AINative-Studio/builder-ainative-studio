/**
 * Primitive wiring detection (#1056) — a real UI/wiring-verified signal
 * distinct from `*Provisioned` (credential issuance).
 *
 * BACKGROUND: #1056's audit found a real enterprise company (`mendr`) with 6
 * primitives marked `*Provisioned: true` (real credentials genuinely issued),
 * but whose generated app's rendered source had ZERO fetch calls to any
 * primitive-proxy endpoint — only /api/db/waitlist and /api/db/visitors. A
 * founder who sees "ZeroInvoice connected" reasonably expects the app's UI to
 * actually use it; the registry had no way to say otherwise.
 *
 * A follow-up spot-check on real `track: 'app'` companies (same #1056) found
 * this is NOT a track-specific or universal gap — some app-track companies
 * (`flashpoint`, `habanero-hub`) genuinely call their provisioned primitives,
 * while others (`castlo`, `credfix-verify-*`, `aerosol`) don't, despite being
 * provisioned. So detection has to run PER GENERATION, not be inferred from
 * `track` or assumed true/false platform-wide.
 *
 * DETECTION METHOD: scan the generated app's rendered source for real fetch
 * calls to the known primitive-proxy prefix, `/api/primitive/{name}/...` —
 * the exact prefix the preview iframe's injected fetch shim
 * (app/api/preview/[id]/route.ts's dbTokenShim) and the production
 * primitive-proxy route both key off. A call with this prefix in the
 * generated code is real, load-bearing evidence the app's own UI reaches
 * that primitive — not a credential-issuance artifact, not the shim's own
 * boilerplate (see the ignored shim-only string in the test suite).
 *
 * Pure + deterministic, mirroring extractDbTables in seed-check.ts. No I/O —
 * callers run this against whatever source resolveStoredApp() already
 * resolved for the ready-gate / seeded-data check, so this costs nothing
 * extra over a re-scan of code already in memory.
 */

import type { FounderScopedPrimitive } from '@/lib/build/primitive-credentials'

/** Primitives recognized in the /api/primitive/{name}/... path, including
 *  contentworkflow — which has no founder credential (it uses Builder's own
 *  service key) but is still a real primitive a generated app can call
 *  through the exact same proxy prefix (see preview route's own doc comment
 *  on why contentworkflow still needs — and gets — this binding). */
export type WirablePrimitive = FounderScopedPrimitive | 'contentworkflow'

const KNOWN_PRIMITIVES: ReadonlySet<string> = new Set<WirablePrimitive>([
  'zerocommerce', 'zeropipeline', 'agentflow', 'zeroforms', 'zerocrm',
  'zerovoice', 'zeroinvoice', 'serviceos', 'livestreaming', 'socialgraph',
  'contentworkflow',
])

/**
 * Extract the primitives a generated app's source genuinely calls via the
 * real `/api/primitive/{name}/...` proxy prefix — plain string literals AND
 * template literals, matching extractDbTables's own two-form matching. A
 * fully dynamic segment (`/api/primitive/${p}/...`) doesn't match — we can't
 * know the name statically, and (same fail-open posture as extractDbTables)
 * that's fine: it just means this one dynamic call isn't counted, not that
 * the whole check breaks.
 *
 * Deliberately requires a real name segment right after `/api/primitive/` —
 * the bare prefix alone (e.g. the preview iframe's OWN injected fetch-shim
 * boilerplate, `u.indexOf('/api/primitive/')===0`) never matches, so the
 * shim's presence in rendered preview HTML can never be mistaken for a real
 * generated-app call.
 */
export function extractWiredPrimitives(code: string): WirablePrimitive[] {
  const out: WirablePrimitive[] = []
  const re = /\/api\/primitive\/([a-z]+)\//g
  let m: RegExpExecArray | null
  while ((m = re.exec(code || '')) !== null) {
    const name = m[1]
    if (KNOWN_PRIMITIVES.has(name) && !out.includes(name as WirablePrimitive)) {
      out.push(name as WirablePrimitive)
    }
  }
  return out
}

/**
 * Which `*Wired` registry field corresponds to each wirable primitive —
 * mirrors business-systems.ts's PROVISIONING_FLAG_BY_PRIMITIVE naming
 * convention (`<short>Wired`, matching each primitive's existing
 * `<short>Provisioned` field on AppEntry). ZeroDB/ZeroCommerce/AgentFlow/
 * ZeroForms/ZeroERP are intentionally out of this map's VALUE set for now —
 * only the primitives #1056's registry flags + the Live dashboard's system
 * cards already track get a `*Wired` counterpart, so this stays additive and
 * scoped rather than growing new surface nobody asked for.
 */
export const WIRING_FLAG_BY_PRIMITIVE: Record<WirablePrimitive, string> = {
  zeropipeline: 'pipelineWired',
  zeroinvoice: 'zeroinvoiceWired',
  zerocommerce: 'commerceWired',
  agentflow: 'agentflowWired',
  zeroforms: 'formsWired',
  zerocrm: 'zerocrmWired',
  zerovoice: 'zerovoiceWired',
  serviceos: 'serviceosWired',
  livestreaming: 'livestreamingWired',
  socialgraph: 'socialgraphWired',
  contentworkflow: 'contentWorkflowWired',
}

/** capstack has no /api/primitive/ proxy name of its own (OpenCapStack is
 *  proxied via /api/opencapstack/, a dedicated route — see dbTokenShim's own
 *  same-origin allowlist) — so it's handled separately below rather than via
 *  the generic /api/primitive/ scan. */
const CAPSTACK_RE = /\/api\/opencapstack\//

export type WiringFlags = Record<string, boolean> & { capstackWired: boolean }

/**
 * Compute every `*Wired` flag for a generated app's source in one pass.
 * Every known primitive's flag is present and explicitly false/true — never
 * omitted — so a caller can diff against WIRING_FLAG_BY_PRIMITIVE without
 * special-casing "key absent means false".
 */
export function computeWiringFlags(code: string): WiringFlags {
  const wired = new Set(extractWiredPrimitives(code))
  const flags: Record<string, boolean> = {}
  for (const [primitive, flagKey] of Object.entries(WIRING_FLAG_BY_PRIMITIVE)) {
    flags[flagKey] = wired.has(primitive as WirablePrimitive)
  }
  flags.capstackWired = CAPSTACK_RE.test(code || '')
  return flags as WiringFlags
}
