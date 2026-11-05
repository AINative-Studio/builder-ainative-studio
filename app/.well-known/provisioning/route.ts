/**
 * GET /.well-known/provisioning (AX/agent-readiness scan, AR-PROV gap, 2026-10-29;
 * field-shape fix #1834) — Builder already has real, working, production
 * provisioning: POST /api/build/provision (see
 * app/api/build/provision/route.ts), which gives a company shipped from
 * /build its own real per-company data layer via AINative Instant DB. This
 * document points an external agent at that REAL, already-functioning
 * endpoint — it does not stand up new provisioning logic.
 *
 * Shape follows the AR-PROV spec (agentready-org/standard PR #9), matching
 * the field names used by ainative.ax's own reference implementation at
 * https://ainative.ax/.well-known/provisioning: top-level spec_version,
 * provider.terms_uri, capabilities[].transports[] (each transport is
 * {type, uri}, not a single "transport binding" field), and consent.models.
 * #1834 found the PREVIOUS version of this document used builder-internal
 * field names (version/provisioning_endpoint/method) that don't match the
 * spec at all, so AX audits correctly flagged every required field as
 * missing even though a real, working endpoint exists.
 *
 * Two real paths, resolved server-side from the caller's own session (never
 * from a client-sent `plan` field, which has never been read — #1014):
 *  - Signed-in founder (NextAuth session cookie) → PERMANENT sk_ key
 *    immediately, auto-assigned to their Default Workspace.
 *  - Anonymous → TEMPORARY tmp_ key (~24h expiry) + a claim token, upgradeable
 *    to permanent later via a signed-in payment with no data loss.
 *
 * See /openapi.json's '/api/build/provision' entry for the full request/
 * response schema.
 */

const ORIGIN = process.env.NEXT_PUBLIC_APP_URL || 'https://builder.ainative.studio'

export async function GET() {
  return Response.json(
    {
      spec_version: '0.1.0',
      provider: {
        name: 'AINative Builder',
        terms_uri: 'https://ainative.studio/terms',
        pricing_uri: `${ORIGIN}/pricing`,
      },
      capabilities: [
        {
          name: 'org.agentready.prov.provision',
          version: '2026-10-29',
          description:
            "Provisions a real, persistent per-company data layer (AINative Instant DB) for a company previously created via Builder's /build flow. This is the same provisioning Builder's own founder-facing UI uses — not a separate agent-only capability.",
          transports: [
            {
              type: 'rest',
              method: 'POST',
              uri: `${ORIGIN}/api/build/provision`,
            },
          ],
          request_body: {
            content_type: 'application/json',
            schema: {
              slug: 'string, required — the company slug returned when the company was created',
              name: 'string, optional',
            },
          },
          response: {
            success: {
              ok: true,
              zerodbProjectId: 'string',
              keyKind: 'permanent | tmp',
              created: 'boolean',
              claimable: 'boolean',
              deployUrl: 'string',
              dnsPointable: 'boolean',
            },
            failure: { ok: false, reason: 'string' },
          },
        },
        {
          name: 'org.agentready.prov.terms',
          version: '2026-10-29',
          transports: [
            { type: 'rest', uri: 'https://ainative.studio/terms' },
            { type: 'rest', uri: `${ORIGIN}/pricing` },
          ],
        },
      ],
      consent: {
        models: ['session-cookie', 'anonymous-claimable'],
        description:
          "Signed-in: a valid NextAuth session cookie provisions a PERMANENT key immediately, auto-assigned to the founder's Default Workspace. Anonymous: provisions a TEMPORARY key (~24h expiry) plus a claim token; a later signed-in payment can upgrade it to permanent with no data loss. A `plan` field sent in the request body is ignored — entitlement is always resolved server-side from the caller's own session, never taken from the caller.",
      },
      limits: {
        step_up_possible: true,
        step_up_description: 'Anonymous tmp_ key can step up to a permanent sk_ key via a signed-in payment, with no data loss.',
      },
      openapi_reference: `${ORIGIN}/openapi.json`,
    },
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  )
}
