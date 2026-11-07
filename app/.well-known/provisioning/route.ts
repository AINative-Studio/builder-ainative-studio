/**
 * GET /.well-known/provisioning (AX/agent-readiness scan, AR-PROV gap, 2026-10-29;
 * field-shape fix #1834; anonymous-claim accuracy fix #1848) — Builder
 * already has real, working, production provisioning: POST
 * /api/build/provision (see app/api/build/provision/route.ts), which gives a
 * company shipped from /build its own real per-company data layer via
 * AINative Instant DB. This document points an external agent at that REAL,
 * already-functioning endpoint — it does not stand up new provisioning
 * logic.
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
 * #1848 found this document's `anonymous-claimable` consent model, while
 * technically accurate about THIS ONE ROUTE in isolation (provision/
 * route.ts's own `auth().catch(() => null)` really does tolerate a null
 * session and really does mint a tmp_ key), was misleading about the
 * overall product: confirmed live (an actual anonymous browser session
 * against builder.ainative.studio/build) that a visitor with no account
 * cannot reach the point where a slug/company even EXISTS for this route to
 * act on — /build itself requires "Get started" → signup before any idea
 * input is shown, no code generation or preview happens pre-auth. The
 * anonymous tmp_-key path this route describes is reachable only via a
 * DIFFERENT, already-authenticated-adjacent flow (a company created through
 * the signed-in UI, provisioned with a session that then expires/is
 * cleared) — not a true "zero-signup" entry point an agent could use cold.
 * Removed the anonymous-claimable consent model and the step-up limits
 * block accordingly, since advertising them here implied a capability
 * reachable from the front door that isn't.
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
        models: ['session-cookie'],
        description:
          "Requires a signed-in NextAuth session cookie, which provisions a PERMANENT key immediately, auto-assigned to the founder's Default Workspace. Builder's /build flow itself requires account creation before a company/slug exists for this endpoint to act on — there is no unauthenticated entry point an agent can reach cold. A `plan` field sent in the request body is ignored — entitlement is always resolved server-side from the caller's own session, never taken from the caller.",
      },
      openapi_reference: `${ORIGIN}/openapi.json`,
    },
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  )
}
