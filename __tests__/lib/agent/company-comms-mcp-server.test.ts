/**
 * Company-comms MCP server (#733) — unit tests for the tool-handler logic.
 * Mocks the HTTP layer (global fetch) and asserts the real request shapes
 * this server sends to this app's own /api/build/company-comms and
 * /api/build/company-email routes, plus honest failure surfacing when
 * either route is unreachable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TOOLS, callCompanyComms, callCompanyEmail } from '@/lib/agent/mcp-servers/company-comms-mcp-server.mjs'

function toolByName(name: string) {
  const tool = TOOLS.find((t) => t.name === name)
  if (!tool) throw new Error(`tool not found: ${name}`)
  return tool
}

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response
}

describe('company-comms-mcp-server (#733)', () => {
  const realFetch = global.fetch

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_APP_URL
    global.fetch = vi.fn()
  })

  afterEach(() => {
    global.fetch = realFetch
    delete process.env.NEXT_PUBLIC_APP_URL
    vi.restoreAllMocks()
  })

  it('exposes exactly the two founder/customer-outreach tools, framed as outreach not bare send primitives', () => {
    const names = TOOLS.map((t) => t.name)
    expect(names).toEqual(['contact_founder_for_feedback', 'send_project_update_email'])
    expect(toolByName('contact_founder_for_feedback').description).toMatch(/feedback|status update/i)
    expect(toolByName('send_project_update_email').description).toMatch(/feedback|status update/i)
  })

  describe('callCompanyComms', () => {
    it('posts to /api/build/company-comms on the default production host', async () => {
      ;(global.fetch as any).mockResolvedValue(jsonResponse({ ok: true, sid: 'SMxxxx' }))
      const result = await callCompanyComms({ slug: 'acme', action: 'sms', to: '+15550002222', body: 'hi' })
      expect(result).toEqual({ ok: true, sid: 'SMxxxx' })
      const [url, init] = (global.fetch as any).mock.calls[0]
      expect(url).toBe('https://builder.ainative.studio/api/build/company-comms')
      expect(JSON.parse(init.body)).toEqual({ slug: 'acme', action: 'sms', to: '+15550002222', body: 'hi' })
    })

    it('honors NEXT_PUBLIC_APP_URL override', async () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://staging.example.com'
      ;(global.fetch as any).mockResolvedValue(jsonResponse({ ok: true, callId: 'CAxxxx' }))
      await callCompanyComms({ slug: 'acme', action: 'call', to: '+15550002222' })
      const [url] = (global.fetch as any).mock.calls[0]
      expect(url).toBe('https://staging.example.com/api/build/company-comms')
    })

    it('surfaces an honest reason on a network failure, never throws', async () => {
      ;(global.fetch as any).mockRejectedValue(new Error('ECONNREFUSED'))
      const result = await callCompanyComms({ slug: 'acme', action: 'sms', to: '+15550002222', body: 'hi' })
      expect(result.ok).toBe(false)
      expect(result.reason).toContain('ECONNREFUSED')
    })

    it('passes through the honest failure reason from the route', async () => {
      ;(global.fetch as any).mockResolvedValue(jsonResponse({ ok: false, reason: 'no_zerovoice_number_provisioned' }))
      const result = await callCompanyComms({ slug: 'acme', action: 'sms', to: '+15550002222', body: 'hi' })
      expect(result).toEqual({ ok: false, reason: 'no_zerovoice_number_provisioned' })
    })
  })

  describe('callCompanyEmail', () => {
    it('posts to /api/build/company-email with the real request shape', async () => {
      ;(global.fetch as any).mockResolvedValue(jsonResponse({ ok: true, id: 'email-123' }))
      const result = await callCompanyEmail('Acme', 'to@x.com', 'Update', '<p>hi</p>', 'hi')
      expect(result).toEqual({ ok: true, id: 'email-123' })
      const [url, init] = (global.fetch as any).mock.calls[0]
      expect(url).toBe('https://builder.ainative.studio/api/build/company-email')
      expect(JSON.parse(init.body)).toEqual({ companyName: 'Acme', to: 'to@x.com', subject: 'Update', html: '<p>hi</p>', text: 'hi' })
    })

    it('surfaces an honest reason on a network failure, never throws', async () => {
      ;(global.fetch as any).mockRejectedValue(new Error('ECONNREFUSED'))
      const result = await callCompanyEmail('Acme', 'to@x.com', 'Update', '<p>hi</p>', 'hi')
      expect(result.ok).toBe(false)
      expect(result.reason).toContain('ECONNREFUSED')
    })
  })

  describe('tool handlers', () => {
    it('contact_founder_for_feedback maps channel:sms to action:sms with body', async () => {
      ;(global.fetch as any).mockResolvedValue(jsonResponse({ ok: true, sid: 'SMxxxx' }))
      await toolByName('contact_founder_for_feedback').handler({
        slug: 'acme',
        to: '+15550002222',
        channel: 'sms',
        message: 'How is the build going?',
      })
      const [, init] = (global.fetch as any).mock.calls[0]
      expect(JSON.parse(init.body)).toEqual({ slug: 'acme', action: 'sms', to: '+15550002222', body: 'How is the build going?' })
    })

    it('contact_founder_for_feedback maps channel:call to action:call and passes record through', async () => {
      ;(global.fetch as any).mockResolvedValue(jsonResponse({ ok: true, callId: 'CAxxxx' }))
      await toolByName('contact_founder_for_feedback').handler({
        slug: 'acme',
        to: '+15550002222',
        channel: 'call',
        record: true,
      })
      const [, init] = (global.fetch as any).mock.calls[0]
      expect(JSON.parse(init.body)).toEqual({ slug: 'acme', action: 'call', to: '+15550002222', record: true })
    })

    it('send_project_update_email falls back text to html when text is omitted', async () => {
      ;(global.fetch as any).mockResolvedValue(jsonResponse({ ok: true, id: 'email-123' }))
      await toolByName('send_project_update_email').handler({
        companyName: 'Acme',
        to: 'to@x.com',
        subject: 'Update',
        html: '<p>Shipped</p>',
      })
      const [, init] = (global.fetch as any).mock.calls[0]
      const body = JSON.parse(init.body)
      expect(body.text).toBe('<p>Shipped</p>')
    })
  })
})
