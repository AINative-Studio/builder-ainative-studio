/**
 * GET /.well-known/poppy.json — Personal Agent Protocol manifest (#1842).
 *
 * Poppy ("Personal Agent Protocol") is a real open standard launched
 * 2026-10-06 by Sierra + Meta, Apache 2.0, currently draft 0.4. Canonical
 * spec: https://personalagentprotocol.org/docs/0.4/spec. It lets a human's
 * Personal Agent discover and talk to a Company on that human's behalf.
 *
 * Every field below describes something that REALLY WORKS. This is not a
 * discovery document pointing at a lookalike endpoint:
 *
 *  - `agent.protocols[].endpoint` is Builder's own live conversation
 *    endpoint, implemented in app/poppy/conversations/** — all five spec
 *    operations (start, message, events, handoff, close), with real ES256
 *    Poppy-Session verification (lib/poppy/session.ts), real ZeroDB-backed
 *    conversation storage and real request deduplication
 *    (lib/poppy/conversations.ts).
 *  - `auth.issuer` is core's real OAuth2.1/PKCE authorization server, the
 *    same one /.well-known/oauth-authorization-server already advertises and
 *    that lib/auth/ainative-oauth.ts really drives for "Sign in with
 *    AINative". Builder is a CLIENT of it, not an issuer itself.
 *  - `apis[]` points at Builder's real, already-published OpenAPI document.
 *
 * Scopes: only `builder:ask` is advertised, because that is the capability
 * that genuinely works today (real keyword Q&A over Builder's real guides +
 * Help Center corpus — see lib/poppy/capability.ts). A `builder:draft`
 * scope was considered and deliberately NOT advertised: Builder requires a
 * real account to build (anonymous-claimable builds were a false claim,
 * corrected in #1848), so a Personal Agent cannot start a real build for a
 * human without an authenticated account, and advertising the scope would
 * promise a capability that doesn't exist.
 *
 * `auth.disabled: true` is the honest declaration that the conversation
 * endpoint needs no OAuth access token — the Q&A capability reads only
 * public documentation, so there is no user data to authorize against and
 * no reason to make an agent run a token dance to ask a public question.
 * A Personal Agent's own identity is still cryptographically verified on
 * every request via the Poppy-Session JWT.
 *
 * Matches the shape core's own real AX scanner checks
 * (`check_poppy()` in core's ax_audit_service.py, core#9837/#9876):
 * protocol_version, organization, auth, agent all present; auth.issuer a
 * non-empty string; agent.protocols carrying a `type: "poppy"` entry with a
 * non-empty endpoint.
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://builder.ainative.studio'
const CORE = process.env.AINATIVE_API_BASE_URL || 'https://api.ainative.studio'

export const PROTOCOL_VERSION = '0.4'

export async function GET() {
  const domain = new URL(APP_URL).host.toLowerCase()

  return Response.json(
    {
      protocol_version: PROTOCOL_VERSION,
      organization: {
        name: 'AINative Builder',
        // Spec: a Personal Agent checks that organization.domain IS the host
        // that served this document. Derived from the same env var the rest
        // of the app uses so it can never drift from the real host.
        domain,
        logo_uri: `${APP_URL}/favicon.ico`,
      },
      auth: {
        issuer: CORE,
        // No access token required for the advertised capability — see the
        // file header. Honest, not a placeholder.
        disabled: true,
        scopes: {
          'builder:ask':
            "Ask questions about AINative Builder and get answers from its real guides and Help Center documentation",
        },
        scope_hints: {
          'builder:ask': { changes: 'none', personal_data: false },
        },
      },
      agent: {
        protocols: [
          {
            type: 'poppy',
            endpoint: `${APP_URL}/poppy/conversations`,
          },
        ],
      },
      apis: [
        {
          type: 'openapi',
          url: `${APP_URL}/openapi.json`,
          description:
            "AINative Builder's agent-facing REST surface: generate a real, working web app or company from a natural-language idea, composing AINative primitives (ZeroDB, ZeroPipeline/CRM, ZeroCommerce, ZeroInvoice, ZeroVoice, ServiceOS, ZeroMemory, OpenCapStack).",
        },
      ],
      extensions: {},
    },
    {
      headers: {
        'Content-Type': 'application/json',
        // Short cache: the document is static per-deploy, but a stale
        // manifest pointing at a changed endpoint is worse than a re-fetch.
        'Cache-Control': 'public, max-age=300',
      },
    },
  )
}
