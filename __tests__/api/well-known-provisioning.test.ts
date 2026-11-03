import { describe, it, expect } from 'vitest'
import { GET } from '@/app/.well-known/provisioning/route'

describe('GET /.well-known/provisioning (AX/agent-readiness scan, AR-PROV gap)', () => {
  it('returns 200 with the real provisioning endpoint and method', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const doc = await res.json()
    expect(doc.provisioning_endpoint).toBe('/api/build/provision')
    expect(doc.method).toBe('POST')
  })

  it('documents the real request body shape', async () => {
    const res = await GET()
    const doc = await res.json()
    expect(doc.request_body?.schema?.slug).toMatch(/required/i)
  })

  it('documents both real auth paths and their key kinds', async () => {
    const res = await GET()
    const doc = await res.json()
    expect(doc.authentication?.signed_in?.key_kind).toBe('permanent')
    expect(doc.authentication?.anonymous?.key_kind).toBe('tmp')
  })

  it('documents the real success and failure response shapes', async () => {
    const res = await GET()
    const doc = await res.json()
    expect(doc.response?.success?.ok).toBe(true)
    expect(doc.response?.failure?.ok).toBe(false)
  })

  it('is cacheable', async () => {
    const res = await GET()
    expect(res.headers.get('Cache-Control')).toContain('max-age')
  })
})
