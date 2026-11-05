import { describe, it, expect } from 'vitest'
import { GET } from '@/app/.well-known/provisioning/route'

describe('GET /.well-known/provisioning (AR-PROV spec-shape fix, #1834)', () => {
  it('returns 200 with the required top-level AR-PROV fields', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const doc = await res.json()
    expect(doc.spec_version).toBe('0.1.0')
    expect(doc.provider).toBeTruthy()
    expect(Array.isArray(doc.capabilities)).toBe(true)
    expect(doc.consent).toBeTruthy()
  })

  it('provider includes terms_uri', async () => {
    const res = await GET()
    const doc = await res.json()
    expect(doc.provider.terms_uri).toBe('https://ainative.studio/terms')
  })

  it('every capability declares at least one transport binding', async () => {
    const res = await GET()
    const doc = await res.json()
    expect(doc.capabilities.length).toBeGreaterThan(0)
    for (const capability of doc.capabilities) {
      expect(Array.isArray(capability.transports)).toBe(true)
      expect(capability.transports.length).toBeGreaterThan(0)
      for (const transport of capability.transports) {
        expect(transport.type).toBeTruthy()
        expect(transport.uri).toBeTruthy()
      }
    }
  })

  it('the provision capability points at the real POST /api/build/provision endpoint', async () => {
    const res = await GET()
    const doc = await res.json()
    const provisionCapability = doc.capabilities.find(
      (c: { name: string }) => c.name === 'org.agentready.prov.provision',
    )
    expect(provisionCapability).toBeTruthy()
    const transport = provisionCapability.transports.find(
      (t: { uri: string }) => t.uri.endsWith('/api/build/provision'),
    )
    expect(transport).toBeTruthy()
    expect(transport.method).toBe('POST')
  })

  it('consent.models is non-empty', async () => {
    const res = await GET()
    const doc = await res.json()
    expect(Array.isArray(doc.consent.models)).toBe(true)
    expect(doc.consent.models.length).toBeGreaterThan(0)
  })

  it('documents the real request body shape on the provision capability', async () => {
    const res = await GET()
    const doc = await res.json()
    const provisionCapability = doc.capabilities.find(
      (c: { name: string }) => c.name === 'org.agentready.prov.provision',
    )
    expect(provisionCapability.request_body?.schema?.slug).toMatch(/required/i)
  })

  it('documents the real success and failure response shapes on the provision capability', async () => {
    const res = await GET()
    const doc = await res.json()
    const provisionCapability = doc.capabilities.find(
      (c: { name: string }) => c.name === 'org.agentready.prov.provision',
    )
    expect(provisionCapability.response?.success?.ok).toBe(true)
    expect(provisionCapability.response?.failure?.ok).toBe(false)
  })

  it('is cacheable', async () => {
    const res = await GET()
    expect(res.headers.get('Cache-Control')).toContain('max-age')
  })
})
