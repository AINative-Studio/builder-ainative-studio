# auth.md — AINative Builder

Agent-facing registration/authentication guide. Pairs with `agents.txt` and
`llms.txt` at the same root.

## Do you need to authenticate at all?

No, not for the core build loop. Builder's product stance is "no signup wall
to build" — `generate-app` (`POST /api/chat-ws`), `generate-artifact`
(`POST /api/build/artifact`), and `ask-cody` (`POST /api/build/ask`) all
accept anonymous callers. Authenticate only when you need a PERMANENT
provisioned data layer, higher rate-limit tiers, or paid-plan capabilities.

## How authentication works

Builder is a CLIENT of AINative core's real OAuth 2.1 / PKCE authorization
server — Builder itself is not an authorization server and has no
bearer-token API-key scheme of its own.

- Discovery document (RFC 8414): `GET /.well-known/oauth-authorization-server`
  — returns the real issuer, `authorization_endpoint`, `token_endpoint`, and
  supported grant/response types, all served by AINative core
  (`api.ainative.studio`), not Builder.
- Authorization code flow with PKCE (`S256`), `response_type=code`.
- Supported grants: `authorization_code`, `refresh_token`.
- Scopes: `openid`, `profile`, `email`.
- Once authorized, Builder issues a NextAuth session cookie. There is no
  separate bearer/API-key header to mint or attach — every session-scoped
  route documented in `/openapi.json` reads that same cookie.

## Provisioning a data layer once authenticated

`GET /.well-known/provisioning` documents the real AR-PROV-shaped manifest
for `POST /api/build/provision`:

- Signed-in (valid NextAuth session cookie) → a PERMANENT key, immediately
  assigned to the founder's Default Workspace.
- Anonymous → a TEMPORARY key (~24h expiry) plus a claim token. A later
  signed-in payment upgrades it to permanent with no data loss — this is
  the step-up path, not a second authentication scheme.

## What NOT to assume

- There is no Builder-issued API key for anonymous or session-cookie flows.
  Don't invent an `Authorization: Bearer <token>` header for routes this
  document or `/openapi.json` doesn't call out as requiring one.
- A `plan` field sent to `/api/build/provision` is ignored. Entitlement is
  always resolved server-side from the caller's real session, never taken
  from the request body.

## Reference

- `GET /.well-known/oauth-authorization-server` — real OAuth2.1/PKCE
  discovery (core, not Builder)
- `GET /.well-known/provisioning` — AR-PROV provisioning manifest
- `GET /openapi.json` — full agent-callable route surface
- `GET /agents.txt`, `GET /llms.txt` — capability and product overview
- Contact: admin@ainative.studio
