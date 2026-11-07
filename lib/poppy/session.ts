/**
 * Poppy-Session JWT verification (#1842) — Personal Agent Protocol 0.4,
 * spec section 5 ("Session"), https://personalagentprotocol.org/docs/0.4/spec.
 *
 * ── TRUST MODEL (real, cryptographic — NOT a decode-only stub) ─────────────
 * The Poppy-Session JWT is signed by the PERSONAL AGENT, not by Builder, so
 * none of this repo's existing HMAC helpers (primitive-proxy-token.ts,
 * anon-draft-token.ts — both `createHmac` over a Builder-held secret) can
 * verify it: Builder does not hold the signing key.
 *
 * An earlier reading of this gap assumed Builder would therefore have to
 * decode the claims WITHOUT verifying the signature and document a trust
 * hole, on the theory that verification needs an issuer-key registry Builder
 * doesn't have. That assumption is wrong, and the spec is explicit about why:
 * Poppy deliberately requires NO registry and NO pre-registration. Trust is
 * anchored in the `iss` claim being an HTTPS URL that IS the Personal Agent's
 * own client-metadata document, served from its own domain. Key discovery is
 * on-demand:
 *
 *   iss (client_id URL) → client metadata → jwks_uri → public keys
 *
 * with `jwks_uri` required to be on the same host as `client_id`, so an
 * attacker can only present keys for a domain it actually controls. That is
 * fully implementable here with no new infrastructure, so this module does
 * the REAL verification the spec describes.
 *
 * Two-link signature chain (spec 5.2), both links verified below:
 *
 *   1. DELEGATION (`poppy_dlg` header, typ `poppy-delegation+jwt`)
 *      Signed by a long-lived key published at the agent's `jwks_uri`.
 *      Confirms a short-lived key via its `cnf.jwk` claim. Must be
 *      unexpired, with `exp` at most 24h after `iat`, and `iss` equal to
 *      the session token's `iss`.
 *   2. SESSION (the Poppy-Session header itself, typ `poppy-session+jwt`)
 *      Signed by that delegated key. Its `kid` MUST equal the JWK
 *      thumbprint of the delegation's `cnf.jwk`, binding the two links.
 *
 * Also enforced: `alg` is pinned to ES256 (the spec fixes it, and pinning
 * blocks alg-confusion/`alg: none` downgrades), `aud` must be Builder, and
 * `htm`/`htu` must match the actual request (sender-constraining the token
 * to this method+URL, so a captured header can't be replayed against a
 * different operation).
 *
 * Known, deliberate scope boundary — stated honestly rather than implied:
 * `jti` is NOT tracked for cross-request replay suppression. Per-request
 * replay of the same operation is already made harmless by the protocol's
 * own request-deduplication rule (see lib/poppy/conversations.ts), which
 * returns the stored original response for a repeated body `id` instead of
 * reprocessing. htm/htu binding plus the iat freshness window below are what
 * constrain a stolen header; a `jti` seen-set would be a strict improvement
 * and is a clean follow-up, not a correctness hole in what ships here.
 */

import {
  jwtVerify,
  importJWK,
  decodeProtectedHeader,
  calculateJwkThumbprint,
  type JWK,
} from 'jose'

/** The spec fixes the signing algorithm at ES256. Pinned — never read from the token. */
const ALG = 'ES256'
const SESSION_TYP = 'poppy-session+jwt'
const DELEGATION_TYP = 'poppy-delegation+jwt'

/** Spec 5.2: a delegation's lifetime may be at most 24h. */
const MAX_DELEGATION_LIFETIME_SECONDS = 24 * 60 * 60

/**
 * How stale a session JWT's `iat` may be. The spec sender-constrains each
 * request via htm/htu/iat rather than giving session JWTs an `exp`, so a
 * freshness window is what bounds replay of a captured header. 5 minutes
 * matches the tolerance this repo already uses for signed-request staleness
 * in lib/build/acp-signature.ts's timestamp check.
 */
const MAX_SESSION_AGE_SECONDS = 5 * 60

/** Small clock-skew allowance for `iat` in the future. */
const CLOCK_SKEW_SECONDS = 60

/** Network budget for the two discovery fetches (metadata, then JWKS). */
const DISCOVERY_TIMEOUT_MS = 5000

/** Verified identity of the caller, derived only from verified claims. */
export interface PoppySession {
  /** Personal Agent's client_id (verified `iss`) — half of conversation ownership. */
  clientId: string
  /** Pairwise, opaque User ID for Builder (verified `sub`) — the other half. */
  userId: string
  /** Session ID (`sid`), unique per session. */
  sessionId: string
  /** Optional agent id (`agent_id`). */
  agentId?: string
}

/** Spec-named error codes, returned to the caller verbatim in the body. */
export type PoppySessionErrorCode =
  | 'invalid_session'
  | 'session_ended'
  | 'version_unsupported'

export type PoppySessionResult =
  | { ok: true; session: PoppySession }
  | { ok: false; code: PoppySessionErrorCode; reason: string }

function fail(reason: string, code: PoppySessionErrorCode = 'invalid_session'): PoppySessionResult {
  return { ok: false, code, reason }
}

/**
 * Builder's audience identifier. Spec: the Company's OAuth issuer OR
 * `https://{organization.domain}` lowercased. Builder's poppy.json declares
 * `organization.domain: builder.ainative.studio`, and its `auth.issuer` is
 * core (api.ainative.studio) — a Personal Agent may legitimately pick
 * either, so both are accepted.
 */
export function acceptedAudiences(): string[] {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://builder.ainative.studio'
  const domain = new URL(appUrl).host.toLowerCase()
  const coreIssuer = process.env.AINATIVE_API_BASE_URL || 'https://api.ainative.studio'
  return [`https://${domain}`, coreIssuer]
}

/**
 * Spec 5.2: `client_id` is an HTTPS URL, and `jwks_uri` must live on the same
 * host. This is the ENTIRE trust anchor — without it an attacker could claim
 * any `iss` and point `jwks_uri` at keys it controls on its own domain.
 */
function sameHostHttps(clientId: string, jwksUri: string): boolean {
  try {
    const c = new URL(clientId)
    const j = new URL(jwksUri)
    return c.protocol === 'https:' && j.protocol === 'https:' && c.host.toLowerCase() === j.host.toLowerCase()
  } catch {
    return false
  }
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      // Spec 5.2: fetch the Personal Agent's metadata WITHOUT following
      // redirects — a redirect could otherwise move key discovery onto a host
      // the client_id's domain does not control, breaking the trust anchor.
      redirect: 'manual',
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/**
 * Resolve the Personal Agent's published signing keys: fetch the client
 * metadata at `iss`, then its `jwks_uri` (same-host enforced).
 *
 * Injectable for tests so the suite makes no real network calls.
 */
export type JwksResolver = (clientId: string) => Promise<JWK[] | null>

export const defaultJwksResolver: JwksResolver = async (clientId) => {
  const metadata = await fetchJson(clientId)
  if (!metadata || typeof metadata !== 'object') return null

  const meta = metadata as Record<string, unknown>
  // Spec: the metadata document's own client_id must match the URL it was
  // fetched from, character for character.
  if (typeof meta.client_id === 'string' && meta.client_id !== clientId) return null

  const jwksUri = meta.jwks_uri
  if (typeof jwksUri !== 'string' || !sameHostHttps(clientId, jwksUri)) return null

  const jwks = await fetchJson(jwksUri)
  if (!jwks || typeof jwks !== 'object') return null
  const keys = (jwks as Record<string, unknown>).keys
  if (!Array.isArray(keys)) return null
  return keys.filter((k): k is JWK => Boolean(k) && typeof k === 'object')
}

/** Details of the real HTTP request, for htm/htu sender-constraint checking. */
export interface RequestBinding {
  method: string
  /** Absolute request URL; query and fragment are stripped before comparison. */
  url: string
}

/** Spec: `htu` is the request URL without query or fragment. */
function normalizeHtu(url: string): string | null {
  try {
    const u = new URL(url)
    u.search = ''
    u.hash = ''
    return u.toString()
  } catch {
    return null
  }
}

/**
 * Verify a Poppy-Session JWT and return the caller's identity.
 *
 * Returns a structured failure for every rejection path — never throws, so a
 * malformed or hostile header can't 500 a public route.
 */
export async function verifyPoppySession(
  token: string | null | undefined,
  binding: RequestBinding,
  resolveJwks: JwksResolver = defaultJwksResolver,
): Promise<PoppySessionResult> {
  if (!token || typeof token !== 'string') return fail('Poppy-Session header is missing')

  // --- Read the (still untrusted) header to find the delegation ---
  let header: ReturnType<typeof decodeProtectedHeader>
  try {
    header = decodeProtectedHeader(token)
  } catch {
    return fail('Poppy-Session is not a well-formed JWT')
  }

  if (header.typ !== SESSION_TYP) return fail(`session typ must be ${SESSION_TYP}`)
  if (header.alg !== ALG) return fail(`session alg must be ${ALG}`)

  const delegationJwt = (header as Record<string, unknown>).poppy_dlg
  if (typeof delegationJwt !== 'string' || !delegationJwt) {
    return fail('session header is missing the poppy_dlg delegation')
  }

  // --- The `iss` is the trust anchor; read it before fetching anything ---
  let delegationHeader: ReturnType<typeof decodeProtectedHeader>
  try {
    delegationHeader = decodeProtectedHeader(delegationJwt)
  } catch {
    return fail('poppy_dlg is not a well-formed JWT')
  }
  if (delegationHeader.typ !== DELEGATION_TYP) return fail(`delegation typ must be ${DELEGATION_TYP}`)
  if (delegationHeader.alg !== ALG) return fail(`delegation alg must be ${ALG}`)
  if (typeof delegationHeader.kid !== 'string' || !delegationHeader.kid) {
    return fail('delegation header is missing kid')
  }

  // `iss` must be present and identical in both links. Read it from the
  // delegation's unverified payload only to locate the JWKS; it is then
  // *proved* by the signature check below and re-checked against the session.
  let unverifiedIss: string
  try {
    const [, payloadB64] = delegationJwt.split('.')
    const claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
    unverifiedIss = typeof claims?.iss === 'string' ? claims.iss : ''
  } catch {
    return fail('delegation payload is not readable JSON')
  }
  if (!unverifiedIss) return fail('delegation is missing iss')
  if (!/^https:\/\//.test(unverifiedIss)) return fail('iss (client_id) must be an https URL')

  // --- Discovery: the agent's own published keys, from its own domain ---
  const keys = await resolveJwks(unverifiedIss)
  if (!keys || keys.length === 0) {
    return fail(`could not resolve signing keys for client_id ${unverifiedIss}`)
  }

  const signingJwk = keys.find((k) => {
    // Match by kid when published; otherwise fall back to thumbprint matching
    // below. Only EC/P-256 keys can carry an ES256 signature.
    if (k.kid) return k.kid === delegationHeader.kid
    return false
  }) ?? (await findByThumbprint(keys, delegationHeader.kid))

  if (!signingJwk) return fail('no published key matches the delegation kid')

  // --- Link 1: verify the delegation with the published key ---
  let delegationPayload: Record<string, unknown>
  try {
    const key = await importJWK(signingJwk, ALG)
    const { payload } = await jwtVerify(delegationJwt, key, {
      algorithms: [ALG],
      typ: DELEGATION_TYP,
      issuer: unverifiedIss,
    })
    delegationPayload = payload as Record<string, unknown>
  } catch {
    return fail('delegation signature verification failed')
  }

  const iat = typeof delegationPayload.iat === 'number' ? delegationPayload.iat : null
  const exp = typeof delegationPayload.exp === 'number' ? delegationPayload.exp : null
  if (iat === null || exp === null) return fail('delegation must carry both iat and exp')
  if (exp - iat > MAX_DELEGATION_LIFETIME_SECONDS) {
    return fail('delegation lifetime exceeds the 24h maximum')
  }
  // jwtVerify already rejects an expired delegation via `exp`.

  const cnf = delegationPayload.cnf as { jwk?: JWK } | undefined
  const confirmedJwk = cnf?.jwk
  if (!confirmedJwk || typeof confirmedJwk !== 'object') {
    return fail('delegation is missing the cnf.jwk confirmation key')
  }

  // --- Bind link 2 to link 1: session kid MUST be cnf.jwk's thumbprint ---
  let confirmedThumbprint: string
  try {
    confirmedThumbprint = await calculateJwkThumbprint(confirmedJwk)
  } catch {
    return fail('delegation cnf.jwk is not a valid JWK')
  }
  if (header.kid !== confirmedThumbprint) {
    return fail('session kid does not match the delegated key thumbprint')
  }

  // --- Link 2: verify the session with the delegated key ---
  let claims: Record<string, unknown>
  try {
    const key = await importJWK(confirmedJwk, ALG)
    const { payload } = await jwtVerify(token, key, {
      algorithms: [ALG],
      typ: SESSION_TYP,
      issuer: unverifiedIss,
      audience: acceptedAudiences(),
    })
    claims = payload as Record<string, unknown>
  } catch {
    return fail('session signature or audience verification failed')
  }

  // --- Sender constraint: this token is bound to THIS method and URL ---
  const sessionIat = typeof claims.iat === 'number' ? claims.iat : null
  if (sessionIat === null) return fail('session is missing iat')
  const nowSeconds = Math.floor(Date.now() / 1000)
  if (sessionIat > nowSeconds + CLOCK_SKEW_SECONDS) return fail('session iat is in the future')
  if (nowSeconds - sessionIat > MAX_SESSION_AGE_SECONDS) {
    return fail('session is too old', 'session_ended')
  }

  if (typeof claims.htm !== 'string' || claims.htm.toUpperCase() !== binding.method.toUpperCase()) {
    return fail('session htm does not match the request method')
  }
  const expectedHtu = normalizeHtu(binding.url)
  const presentedHtu = typeof claims.htu === 'string' ? normalizeHtu(claims.htu) : null
  if (!expectedHtu || !presentedHtu || expectedHtu !== presentedHtu) {
    return fail('session htu does not match the request URL')
  }

  // --- Identity, from verified claims only ---
  const sub = typeof claims.sub === 'string' ? claims.sub : ''
  const sid = typeof claims.sid === 'string' ? claims.sid : ''
  if (!sub) return fail('session is missing sub (User ID)')
  if (!sid) return fail('session is missing sid (Session ID)')

  return {
    ok: true,
    session: {
      clientId: unverifiedIss, // proved by both signature checks above
      userId: sub,
      sessionId: sid,
      agentId: typeof claims.agent_id === 'string' ? claims.agent_id : undefined,
    },
  }
}

/** Match a published key by RFC 7638 thumbprint when it has no explicit `kid`. */
async function findByThumbprint(keys: JWK[], kid: string): Promise<JWK | undefined> {
  for (const k of keys) {
    try {
      if ((await calculateJwkThumbprint(k)) === kid) return k
    } catch {
      /* not a thumbprint-able key — skip */
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Protocol version negotiation (spec: Poppy-Version header)
// ---------------------------------------------------------------------------

export const SUPPORTED_PROTOCOL_VERSION = '0.4'

/**
 * Check the `Poppy-Version` header. The spec sends it on every request
 * carrying a Session header. A missing header is tolerated (treated as the
 * version Builder serves) rather than rejected, so a slightly-older agent
 * isn't locked out for a header-only omission; a header naming a DIFFERENT
 * version is a real mismatch and gets the spec's own 409 + version_mismatch.
 */
export function checkProtocolVersion(version: string | null | undefined): { ok: boolean } {
  if (!version) return { ok: true }
  return { ok: version.trim() === SUPPORTED_PROTOCOL_VERSION }
}
