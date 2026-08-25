/**
 * /api/build/connect-domain (#53) — bring-your-own domain: connect a domain the
 * founder ALREADY owns (Namecheap/GoDaddy/Cloudflare/…) to their company app.
 *
 * This complements /api/build/domains (which BUYS a new domain, #240). Here the
 * founder owns the domain already; we register it on their provisioned per-company
 * Railway service and tell them the exact DNS records to add at their registrar,
 * then verify propagation + TLS honestly.
 *
 *   POST { slug, domain }  → start connecting. Resolves the company:
 *       • provisioned (has a Railway service, CNAME-pointable per #240) →
 *         customDomainCreate on Railway → returns the exact DNS records + status.
 *       • not provisioned (durable-preview only, shared origin) → { needs_provision:true }
 *         (a shared-origin slug can't take a CNAME; the founder must provision first).
 *   GET  ?slug=&domain=    → poll status of an in-progress / already-connected domain.
 *       Runs a fast DoH DNS pre-check, then reads Railway's cert status, and maps to
 *       an honest lifecycle: pending → verifying → live. NEVER reports 'live' while the
 *       TLS cert is still issuing (see the ainative-dns skill: HTTPS 000 = issuing).
 *
 * Idempotent: POSTing an already-connected domain returns its current status; GET
 * re-opens show the live status of a connected domain.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { resolveApp, setAppByoDomain } from '@/lib/build/app-registry'
import {
  createCustomDomain,
  getCustomDomainStatus,
  checkDnsRecord,
  normalizeDomain,
  isValidCustomDomain,
  railwayDeployEnabled,
  type CustomDomainResult,
} from '@/lib/build/railway-deploy'

export const runtime = 'nodejs'

/** Host (no scheme) of a company's Railway service — the CNAME target for BYO (#240). */
function serviceHostFromUrl(url?: string): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).host
  } catch {
    return url.replace(/^https?:\/\//, '').replace(/\/.*$/, '') || undefined
  }
}

/**
 * A company is BYO-eligible only when it has a dedicated, CNAME-pointable host —
 * i.e. a provisioned per-company Railway service (#240/#243). A durable-preview-only
 * company lives under the shared origin and can't take a CNAME.
 */
function railwayServiceFor(app: { railwayServiceId?: string; deployUrl?: string } | null) {
  if (!app?.railwayServiceId) return null
  return { serviceId: app.railwayServiceId, cnameTarget: serviceHostFromUrl(app.deployUrl) }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const slug = String(body?.slug || '').trim()
  const rawDomain = String(body?.domain || '')
  const domain = normalizeDomain(rawDomain)

  if (!slug) return Response.json({ ok: false, error: 'slug required' }, { status: 400 })
  if (!domain || !isValidCustomDomain(domain)) {
    return Response.json({ ok: false, error: 'a valid domain you own is required (e.g. myco.com)' }, { status: 400 })
  }

  // Connecting a domain is an account-scoped action on a real, owned company. Require
  // sign-in so anonymous callers can't attach domains to companies they don't own.
  const session = await auth()
  const token = (session as any)?.accessToken
  if (!token) return Response.json({ ok: false, reason: 'signin' })

  const app = await resolveApp(slug).catch(() => null)
  if (!app) return Response.json({ ok: false, error: 'company not found' }, { status: 404 })

  const svc = railwayServiceFor(app)
  if (!svc) {
    // Shared-origin slug → not CNAME-pointable. Prompt the founder to provision first.
    return Response.json({
      ok: false,
      needs_provision: true,
      detail:
        'Connecting a domain you own needs a dedicated host. Provision this company (upgrade) first, then connect your domain.',
    })
  }

  if (!railwayDeployEnabled()) {
    // Provisioning exists but the connect path isn't enabled in this env — honest, no fake success.
    return Response.json({ ok: false, reason: 'disabled', detail: 'Custom-domain connect is not enabled in this environment.' })
  }

  const res: CustomDomainResult = await createCustomDomain(svc.serviceId, domain, undefined, svc.cnameTarget)
  if (!res.ok) {
    const status = res.reason === 'bad_domain' ? 400 : 502
    return Response.json({ ok: false, error: res.reason || 'could not connect domain' }, { status })
  }

  // Persist the connection so re-opens are idempotent and Live can surface it.
  await setAppByoDomain(slug, { domain: res.domain || domain, byoDomainId: res.id, status: res.status }).catch(() => {})

  return Response.json({
    ok: true,
    domain: res.domain,
    status: res.status,
    dnsRecords: res.dnsRecords,
    cnameTarget: res.cnameTarget,
  })
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const slug = (url.searchParams.get('slug') || '').trim()
  const domainParam = normalizeDomain(url.searchParams.get('domain') || '')
  if (!slug) return Response.json({ ok: false, error: 'slug required' }, { status: 400 })

  const app = await resolveApp(slug).catch(() => null)
  if (!app) return Response.json({ ok: false, error: 'company not found' }, { status: 404 })

  // Default to the already-connected domain on the company when none is passed, so a
  // bare re-open (?slug=) shows the current status of the connected domain (idempotent).
  const domain = domainParam || (app.byoDomain ? normalizeDomain(app.byoDomain) : '')
  if (!domain) return Response.json({ ok: true, status: null, connected: false })

  const svc = railwayServiceFor(app)
  if (!svc) return Response.json({ ok: false, needs_provision: true })

  if (!railwayDeployEnabled()) {
    // Can't reach Railway — fall back to the last persisted status honestly.
    return Response.json({ ok: true, domain, status: app.byoDomainStatus || 'pending', connected: !!app.byoDomain })
  }

  // Read Railway's cert/DNS status. If Railway hasn't seen the records yet, run a fast
  // DoH pre-check so we can honestly move pending → verifying the moment DNS resolves.
  const res = await getCustomDomainStatus(svc.serviceId, domain, undefined, svc.cnameTarget)
  let status = res.ok ? res.status : (app.byoDomainStatus || 'pending')
  if (status === 'pending') {
    const dnsSeen = await checkDnsRecord(domain, svc.cnameTarget || 'up.railway.app')
    if (dnsSeen) status = 'verifying'
  }

  // Persist the observed status so the registry stays current for re-opens.
  await setAppByoDomain(slug, { domain, byoDomainId: res.id || app.byoDomainId, status }).catch(() => {})

  return Response.json({
    ok: true,
    domain,
    status,
    connected: true,
    dnsRecords: res.ok ? res.dnsRecords : undefined,
    cnameTarget: svc.cnameTarget,
  })
}
