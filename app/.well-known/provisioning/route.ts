/**
 * GET /.well-known/provisioning (AX/agent-readiness scan, AR-PROV gap, 2026-10-29)
 * — Builder already has real, working, production provisioning: POST
 * /api/build/provision (see app/api/build/provision/route.ts), which gives a
 * company shipped from /build its own real per-company data layer via
 * AINative Instant DB. This document points an external agent at that REAL,
 * already-functioning endpoint — it does not stand up new provisioning logic.
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

export async function GET() {
  return Response.json(
    {
      version: '1.0',
      provisioning_endpoint: '/api/build/provision',
      method: 'POST',
      description:
        "Provisions a real, persistent per-company data layer (AINative Instant DB) for a company previously created via Builder's /build flow. This is the same provisioning Builder's own founder-facing UI uses — not a separate agent-only capability.",
      request_body: {
        content_type: 'application/json',
        schema: {
          slug: 'string, required — the company slug returned when the company was created',
          name: 'string, optional',
        },
      },
      authentication: {
        signed_in: {
          description: 'A valid NextAuth session cookie provisions a PERMANENT key immediately, auto-assigned to the founder\'s Default Workspace.',
          key_kind: 'permanent',
        },
        anonymous: {
          description: 'No session provisions a TEMPORARY key (~24h expiry) plus a claim token. A later signed-in payment can upgrade the temporary key to permanent with no data loss.',
          key_kind: 'tmp',
        },
        note: 'A `plan` field sent in the request body is ignored — entitlement is always resolved server-side from the caller\'s own session, never taken from the caller.',
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
      openapi_reference: '/openapi.json',
    },
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  )
}
