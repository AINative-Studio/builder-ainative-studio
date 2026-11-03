/**
 * GET /.well-known/x402 (#1682) — discovery-only x402 payment document.
 *
 * Builder does NOT support autonomous agent payment execution (x402,
 * on-chain, or otherwise). This is a deliberate scope decision, not an
 * oversight — see app/api/agent402/[action]/route.ts for the full rationale
 * (real-money and on-chain-transaction risk; a generated app has no business
 * initiating payments through a shared platform key).
 *
 * This route exists only so an agent probing /.well-known/x402 gets an
 * honest "unsupported" answer plus a pointer to the real, read-only
 * Agent402 integration that IS wired — not a 404, and not a fabricated
 * payment/challenge endpoint.
 *
 * Originally shipped as a static public/.well-known/x402 file (no
 * extension), which 404'd in production — Next.js's static file serving
 * for `public/` does not reliably serve extensionless files the way it
 * serves `security.txt` or `ai-plugin.json`. Converted to a real route
 * handler, matching the working pattern already proven at
 * /.well-known/oauth-authorization-server, /.well-known/provisioning, and
 * /.well-known/api-catalog.
 */

export async function GET() {
  return Response.json(
    {
      schema_version: 'v1',
      service: 'AINative Builder',
      x402_supported: false,
      description:
        'AINative Builder does not currently support autonomous agent payment execution (x402, on-chain, or otherwise). This is a deliberate scope decision, not an oversight: a generated app has no business initiating real-money or on-chain transactions through a shared platform key. See app/api/agent402/[action]/route.ts in this repo for the full rationale.',
      related_integration: {
        name: 'Agent402',
        description:
          "Builder proxies read-only, account-level Agent402 endpoints for a generated app to introspect its own payment-related capabilities. No payment, billing, or on-chain execution is wired.",
        endpoints: [
          {
            method: 'GET',
            path: 'https://builder.ainative.studio/api/agent402/capabilities',
            description: "Agent402's account-level capabilities (read-only).",
          },
          {
            method: 'GET',
            path: 'https://builder.ainative.studio/api/agent402/projects',
            description: "Agent402's account-level projects (read-only).",
          },
        ],
      },
      contact_email: 'admin@ainative.studio',
    },
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  )
}
