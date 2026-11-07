/**
 * Test helper: mint REAL, cryptographically valid Poppy-Session JWTs (#1842).
 *
 * These are genuine ES256 signatures over a genuine two-link delegation
 * chain — the same structure a real Personal Agent produces — so the tests
 * exercise lib/poppy/session.ts's actual verification path rather than a
 * bypass. The only thing stubbed is the NETWORK: the JWKS resolver is
 * injected, so no test makes a real HTTP call to discover keys.
 */

import { SignJWT, exportJWK, calculateJwkThumbprint, generateKeyPair, type JWK } from 'jose'
import type { JwksResolver } from '@/lib/poppy/session'

export const TEST_CLIENT_ID = 'https://agent.test.example/poppy-client'
export const TEST_AUDIENCE = 'https://builder.ainative.studio'

export interface PoppyKeyring {
  /** Keys the agent "publishes" at its jwks_uri. */
  publishedJwks: JWK[]
  /** Resolver to inject — returns publishedJwks for TEST_CLIENT_ID only. */
  resolver: JwksResolver
  /** Mint a session JWT bound to a method + URL. */
  mint: (opts: MintOptions) => Promise<string>
}

export interface MintOptions {
  method: string
  url: string
  sub?: string
  sid?: string
  clientId?: string
  audience?: string
  /** Seconds to offset `iat` by (negative = older). */
  iatOffset?: number
  /** Delegation lifetime in seconds (spec max 24h). */
  delegationLifetime?: number
  /** Sign the session with a key the delegation does NOT confirm. */
  useWrongSessionKey?: boolean
  /** Override the session `typ` header. */
  typ?: string
  /** Omit the poppy_dlg delegation header. */
  omitDelegation?: boolean
}

export async function makeKeyring(): Promise<PoppyKeyring> {
  const longTerm = await generateKeyPair('ES256', { extractable: true })
  const delegated = await generateKeyPair('ES256', { extractable: true })
  const impostor = await generateKeyPair('ES256', { extractable: true })

  const longTermPublic = await exportJWK(longTerm.publicKey)
  const longTermKid = await calculateJwkThumbprint(longTermPublic)
  longTermPublic.kid = longTermKid
  const delegatedPublic = await exportJWK(delegated.publicKey)

  const publishedJwks: JWK[] = [longTermPublic]

  const resolver: JwksResolver = async (clientId) =>
    clientId === TEST_CLIENT_ID ? publishedJwks : null

  async function mint(opts: MintOptions): Promise<string> {
    const clientId = opts.clientId ?? TEST_CLIENT_ID
    const now = Math.floor(Date.now() / 1000) + (opts.iatOffset ?? 0)
    const lifetime = opts.delegationLifetime ?? 3600

    const delegation = await new SignJWT({ cnf: { jwk: delegatedPublic } })
      .setProtectedHeader({ alg: 'ES256', typ: 'poppy-delegation+jwt', kid: longTermKid })
      .setIssuer(clientId)
      .setIssuedAt(now)
      .setExpirationTime(now + lifetime)
      .sign(longTerm.privateKey)

    const httpUrl = new URL(opts.url)
    httpUrl.search = ''
    httpUrl.hash = ''

    const header: Record<string, unknown> = {
      alg: 'ES256',
      typ: opts.typ ?? 'poppy-session+jwt',
      kid: await calculateJwkThumbprint(delegatedPublic),
    }
    if (!opts.omitDelegation) header.poppy_dlg = delegation

    return new SignJWT({
      sid: opts.sid ?? 'sess_test',
      sub: opts.sub ?? 'user_test',
      htm: opts.method.toUpperCase(),
      htu: httpUrl.toString(),
      jti: `jti_${Math.random().toString(36).slice(2)}`,
    })
      .setProtectedHeader(header as never)
      .setIssuer(clientId)
      .setAudience(opts.audience ?? TEST_AUDIENCE)
      .setIssuedAt(now)
      .sign(opts.useWrongSessionKey ? impostor.privateKey : delegated.privateKey)
  }

  return { publishedJwks, resolver, mint }
}
