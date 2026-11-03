/**
 * GET /.well-known/api-catalog (RFC 9727, AX/agent-readiness scan 2026-10-29)
 * — a real linkset-shaped catalog pointing an external agent at Builder's
 * already-existing, already-functioning API documentation. This does not
 * stand up any new API surface; it aggregates the discovery documents this
 * repo already serves (see app/openapi.json/route.ts and
 * app/.well-known/oauth-authorization-server/route.ts).
 */

const ORIGIN = process.env.NEXT_PUBLIC_APP_URL || 'https://builder.ainative.studio'

export async function GET() {
  return Response.json(
    {
      linkset: [
        {
          anchor: ORIGIN,
          'service-desc': [
            {
              href: `${ORIGIN}/openapi.json`,
              type: 'application/json',
              title: 'Builder OpenAPI document',
            },
          ],
          'service-doc': [
            {
              href: `${ORIGIN}/.well-known/oauth-authorization-server`,
              type: 'application/json',
              title: 'OAuth 2.1 authorization server metadata (RFC 8414)',
            },
          ],
        },
      ],
    },
    {
      headers: {
        'Content-Type': 'application/linkset+json',
        'Cache-Control': 'public, max-age=3600',
      },
    },
  )
}
