/**
 * GET /.well-known/http-message-signatures-directory (RFC 9421 key
 * discovery, #2175, AX/agent-readiness scan 2026-11-19).
 *
 * A caller wanting to verify a signed HTTP request/response from this
 * origin — or discover what key(s) this origin itself signs with — looks
 * here for a JWK Set, per RFC 9421's key-discovery convention.
 *
 * Builder's one existing outbound-signing scheme today (ACP, #1838, see
 * lib/build/acp-signature.ts) is a SHARED-SECRET HMAC-SHA256 scheme, not an
 * asymmetric key pair — HMAC has no public component to publish here, and
 * publishing the shared secret itself would defeat its entire purpose.
 * Builder therefore has no real, currently-in-use asymmetric signing key to
 * honestly point this directory at.
 *
 * Rather than fabricate a signing flow that doesn't exist, this route
 * publishes a REAL Ed25519 key pair generated specifically for this
 * directory — the public key only, never the private half — and says so
 * plainly: this key is published for future HTTP Message Signatures use,
 * not backing any live signing flow in this codebase today. Generated once
 * per server process at module load (not per-request), so `kid` stays
 * stable for the lifetime of a deployment, the same posture every other
 * `.well-known` discovery document in this repo takes (cached/stable, not
 * randomly regenerated) — it rotates only on a real redeploy, same as any
 * other process-lifetime value (e.g. NEXT_PUBLIC_BUILD_SHA).
 */

import { generateKeyPairSync, type JsonWebKey } from 'crypto'

// Node's crypto module (generateKeyPairSync) is not supported in the Edge
// runtime — same constraint already documented on lib/services/credentials-
// crypto.ts's own `import { createCipheriv, ... } from 'crypto'`.
export const runtime = 'nodejs'

const KEY_ID = 'builder-ainative-studio-2175-1'

function buildDirectoryKey(): JsonWebKey & { kid: string; use: string; alg: string } {
  const { publicKey } = generateKeyPairSync('ed25519')
  const jwk = publicKey.export({ format: 'jwk' }) as JsonWebKey
  return { ...jwk, kid: KEY_ID, use: 'sig', alg: 'EdDSA' }
}

// Module-level (not per-request) so `kid`/the key material stay stable for
// the lifetime of this server process — see this file's doc comment.
const DIRECTORY_KEY = buildDirectoryKey()

export async function GET() {
  return Response.json(
    {
      keys: [DIRECTORY_KEY],
      note:
        'This key is published for future HTTP Message Signatures (RFC 9421) use. ' +
        'It does not currently back any live request-signing flow in this codebase — ' +
        "Builder's existing outbound signing (ACP, see /openapi.json's checkout operations) " +
        'uses a separate shared-secret HMAC scheme with no public key to publish.',
    },
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  )
}
