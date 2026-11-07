import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { makeKeyring, type PoppyKeyring } from '../helpers/poppy-session'

vi.hoisted(() => {
  process.env.ZERODB_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-poppy'
})

/**
 * #1842 — the five Poppy conversation routes, end to end.
 *
 * Real ES256 session JWTs (the helper mints genuine delegation chains) and a
 * real in-memory stand-in for ZeroDB's append-only row API. The JWKS
 * resolver is injected via a module mock so the suite makes NO network
 * calls, while the signature verification itself is the real one.
 */

const BASE = 'https://builder.ainative.studio'

let keyring: PoppyKeyring

// Mock ONLY the network-dependent key discovery; verification stays real.
vi.mock('@/lib/poppy/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/poppy/session')>()
  return {
    ...actual,
    verifyPoppySession: (
      token: string | null | undefined,
      binding: { method: string; url: string },
    ) => actual.verifyPoppySession(token, binding, (cid) => keyring.resolver(cid)),
  }
})

function mockZeroDb() {
  const tables = new Map<string, Array<{ row_id: string; row_data: Record<string, unknown> }>>()
  let nextId = 0
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    const ok = (body: unknown) =>
      ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response
    if (init?.method === 'POST' && u.endsWith('/database/tables')) return ok({})
    const m = u.match(/\/database\/tables\/([^/?]+)\/rows/)
    if (m) {
      const t = m[1]
      if (!tables.has(t)) tables.set(t, [])
      const rows = tables.get(t)!
      if (init?.method === 'POST') {
        rows.push({ row_id: `row-${nextId++}`, row_data: JSON.parse(String(init.body)).row_data })
        return ok({})
      }
      return ok(rows)
    }
    return ok({})
  })
  vi.stubGlobal('fetch', fn)
  return tables
}

async function post(url: string, body: unknown, token: string | null, version = '0.4') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Poppy-Session'] = token
  if (version) headers['Poppy-Version'] = version
  return new NextRequest(url, { method: 'POST', headers, body: JSON.stringify(body) })
}

async function get(url: string, token: string | null, version = '0.4') {
  const headers: Record<string, string> = {}
  if (token) headers['Poppy-Session'] = token
  if (version) headers['Poppy-Version'] = version
  return new NextRequest(url, { method: 'GET', headers })
}

/** Run the full real flow: start a conversation, returning its id. */
async function startConversation(requestId = 'msg_start_1', text = 'how do I add a database to my app?') {
  const { POST } = await import('@/app/poppy/conversations/route')
  const url = `${BASE}/poppy/conversations`
  const token = await keyring.mint({ method: 'POST', url })
  const res = await POST(
    await post(url, { id: requestId, message: { author: { type: 'agent' }, text } }, token),
  )
  return { res, body: await res.json() }
}

beforeEach(async () => {
  vi.resetModules()
  vi.unstubAllGlobals()
  keyring = await makeKeyring()
  mockZeroDb()
})

describe('POST /poppy/conversations — Start Conversation (#1842)', () => {
  it('returns 201 with a real conversation_id', async () => {
    const { res, body } = await startConversation()
    expect(res.status).toBe(201)
    expect(body.conversation_id).toMatch(/^cnv_/)
    expect(res.headers.get('poppy-version')).toBe('0.4')
  })

  it('persists the agent message AND a real docs-backed answer, readable via events', async () => {
    const { body } = await startConversation()
    const { GET } = await import('@/app/poppy/conversations/[id]/events/route')
    const url = `${BASE}/poppy/conversations/${body.conversation_id}/events`
    const token = await keyring.mint({ method: 'GET', url })
    const eventsRes = await GET(await get(url, token), { params: Promise.resolve({ id: body.conversation_id }) })
    expect(eventsRes.status).toBe(200)
    const events = await eventsRes.json()

    expect(events.conversation_id).toBe(body.conversation_id)
    expect(events.events).toHaveLength(2)
    // The agent's own message really was stored.
    expect(events.events[0].message.author.type).toBe('agent')
    expect(events.events[0].message.text).toContain('database')
    // Builder's reply is real corpus content with a real deep link.
    expect(events.events[1].message.author.type).toBe('human')
    expect(events.events[1].message.text).toMatch(/builder\.ainative\.studio\/(guides|help)/)
    expect(events.state.status).toBe('open')
  })

  it('rejects a request with no Poppy-Session (400 invalid_session)', async () => {
    const { POST } = await import('@/app/poppy/conversations/route')
    const url = `${BASE}/poppy/conversations`
    const res = await POST(await post(url, { id: 'msg_x', message: { author: { type: 'agent' }, text: 'hi' } }, null))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_session')
  })

  it('rejects a forged session signature', async () => {
    const { POST } = await import('@/app/poppy/conversations/route')
    const url = `${BASE}/poppy/conversations`
    const token = await keyring.mint({ method: 'POST', url, useWrongSessionKey: true })
    const res = await POST(await post(url, { id: 'msg_x', message: { author: { type: 'agent' }, text: 'hi' } }, token))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_session')
  })

  it('rejects a mismatched Poppy-Version with 409 version_mismatch', async () => {
    const { POST } = await import('@/app/poppy/conversations/route')
    const url = `${BASE}/poppy/conversations`
    const token = await keyring.mint({ method: 'POST', url })
    const res = await POST(await post(url, { id: 'msg_x', message: { author: { type: 'agent' }, text: 'hi' } }, token, '0.3'))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('version_mismatch')
    expect(body.protocol_version).toBe('0.4')
  })

  it('requires body.id', async () => {
    const { POST } = await import('@/app/poppy/conversations/route')
    const url = `${BASE}/poppy/conversations`
    const token = await keyring.mint({ method: 'POST', url })
    const res = await POST(await post(url, { message: { author: { type: 'agent' }, text: 'hi' } }, token))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_request')
  })

  it('never crashes on malformed input', async () => {
    const { POST } = await import('@/app/poppy/conversations/route')
    const url = `${BASE}/poppy/conversations`
    const token = await keyring.mint({ method: 'POST', url })
    for (const raw of ['not json', '[]', 'null', '123', '']) {
      const req = new NextRequest(url, {
        method: 'POST',
        headers: { 'Poppy-Session': token, 'Content-Type': 'application/json' },
        body: raw,
      })
      const res = await POST(req)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('invalid_request')
    }
  })

  it('validates the session BEFORE reporting storage state — no config leak to anonymous callers', async () => {
    vi.stubEnv('ZERODB_API_KEY', '')
    vi.stubEnv('AINATIVE_API_KEY', '')
    vi.stubEnv('API_Key', '')
    vi.resetModules()
    const { POST } = await import('@/app/poppy/conversations/route')
    const url = `${BASE}/poppy/conversations`
    // No session at all → must be invalid_session, NOT temporarily_unavailable.
    const res = await POST(await post(url, { id: 'msg_x', message: { author: { type: 'agent' }, text: 'hi' } }, null))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_session')
    vi.unstubAllEnvs()
  })

  it('an AUTHENTICATED agent gets an honest 503 when storage is unconfigured', async () => {
    vi.stubEnv('ZERODB_API_KEY', '')
    vi.stubEnv('AINATIVE_API_KEY', '')
    vi.stubEnv('API_Key', '')
    vi.resetModules()
    const { POST } = await import('@/app/poppy/conversations/route')
    const url = `${BASE}/poppy/conversations`
    const token = await keyring.mint({ method: 'POST', url })
    const res = await POST(await post(url, { id: 'msg_x', message: { author: { type: 'agent' }, text: 'hi' } }, token))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('temporarily_unavailable')
    vi.unstubAllEnvs()
  })

  it('OPTIONS advertises the allowed methods', async () => {
    const { OPTIONS } = await import('@/app/poppy/conversations/route')
    const res = await OPTIONS()
    expect(res.status).toBe(204)
    expect(res.headers.get('allow')).toContain('POST')
  })
})

describe('request deduplication over the real routes (#1842)', () => {
  it('an identical retry replays the ORIGINAL conversation_id, creating nothing new', async () => {
    const first = await startConversation('msg_retry_1')
    expect(first.res.status).toBe(201)
    const second = await startConversation('msg_retry_1')
    expect(second.res.status).toBe(201)
    // Same id back — the retry did NOT create a second conversation.
    expect(second.body.conversation_id).toBe(first.body.conversation_id)
  })

  it('same request id with a different body returns request_id_conflict', async () => {
    await startConversation('msg_conflict_1', 'first question')
    const { POST } = await import('@/app/poppy/conversations/route')
    const url = `${BASE}/poppy/conversations`
    const token = await keyring.mint({ method: 'POST', url })
    const res = await POST(
      await post(url, { id: 'msg_conflict_1', message: { author: { type: 'agent' }, text: 'DIFFERENT question' } }, token),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('request_id_conflict')
  })
})

describe('POST /poppy/conversations/{id}/messages — Send Message (#1842)', () => {
  it('returns 202 and appends both the message and a real answer', async () => {
    const { body: started } = await startConversation()
    const id = started.conversation_id
    const { POST } = await import('@/app/poppy/conversations/[id]/messages/route')
    const url = `${BASE}/poppy/conversations/${id}/messages`
    const token = await keyring.mint({ method: 'POST', url })
    const res = await POST(
      await post(url, { id: 'msg_2', message: { author: { type: 'agent' }, text: 'how much does it cost?' } }, token),
      { params: Promise.resolve({ id }) },
    )
    expect(res.status).toBe(202)
    expect((await res.json()).conversation_id).toBe(id)

    const { GET } = await import('@/app/poppy/conversations/[id]/events/route')
    const eUrl = `${BASE}/poppy/conversations/${id}/events`
    const eToken = await keyring.mint({ method: 'GET', url: eUrl })
    const events = await (await GET(await get(eUrl, eToken), { params: Promise.resolve({ id }) })).json()
    expect(events.events).toHaveLength(4)
    expect(events.events[2].message.text).toContain('cost')
  })

  it('404 conversation_not_found for an unknown id', async () => {
    const { POST } = await import('@/app/poppy/conversations/[id]/messages/route')
    const url = `${BASE}/poppy/conversations/cnv_nope/messages`
    const token = await keyring.mint({ method: 'POST', url })
    const res = await POST(
      await post(url, { id: 'msg_3', message: { author: { type: 'agent' }, text: 'hi' } }, token),
      { params: Promise.resolve({ id: 'cnv_nope' }) },
    )
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('conversation_not_found')
  })

  it('a DIFFERENT user gets conversation_not_found, never another user transcript', async () => {
    const { body: started } = await startConversation()
    const id = started.conversation_id
    const { POST } = await import('@/app/poppy/conversations/[id]/messages/route')
    const url = `${BASE}/poppy/conversations/${id}/messages`
    // Same agent, different user (different `sub`).
    const otherToken = await keyring.mint({ method: 'POST', url, sub: 'someone_else' })
    const res = await POST(
      await post(url, { id: 'msg_4', message: { author: { type: 'agent' }, text: 'let me see that' } }, otherToken),
      { params: Promise.resolve({ id }) },
    )
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('conversation_not_found')
  })
})

describe('GET /poppy/conversations/{id}/events — Read Events (#1842)', () => {
  it('cursor genuinely resumes after the named event', async () => {
    const { body: started } = await startConversation()
    const id = started.conversation_id
    const { GET } = await import('@/app/poppy/conversations/[id]/events/route')
    const url = `${BASE}/poppy/conversations/${id}/events`
    const token = await keyring.mint({ method: 'GET', url })

    const all = await (await GET(await get(url, token), { params: Promise.resolve({ id }) })).json()
    expect(all.events).toHaveLength(2)
    expect(all.cursor).toBe(all.events[1].id)

    // Resume after the first event → only the second comes back.
    const curUrl = `${url}?cursor=${all.events[0].id}`
    const curToken = await keyring.mint({ method: 'GET', url: curUrl })
    const after = await (await GET(await get(curUrl, curToken), { params: Promise.resolve({ id }) })).json()
    expect(after.events).toHaveLength(1)
    expect(after.events[0].id).toBe(all.events[1].id)

    // Polling at the latest cursor returns nothing new and does not rewind.
    const tipUrl = `${url}?cursor=${all.cursor}`
    const tipToken = await keyring.mint({ method: 'GET', url: tipUrl })
    const tip = await (await GET(await get(tipUrl, tipToken), { params: Promise.resolve({ id }) })).json()
    expect(tip.events).toHaveLength(0)
    expect(tip.cursor).toBe(all.cursor)
  })

  it('validates the wait parameter instead of silently ignoring a bad value', async () => {
    const { body: started } = await startConversation()
    const id = started.conversation_id
    const { GET } = await import('@/app/poppy/conversations/[id]/events/route')
    for (const wait of ['abc', '-1', '9999']) {
      const url = `${BASE}/poppy/conversations/${id}/events?wait=${wait}`
      const token = await keyring.mint({ method: 'GET', url })
      const res = await GET(await get(url, token), { params: Promise.resolve({ id }) })
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('invalid_request')
    }
    // A valid wait is accepted (returns immediately — documented in the route).
    const okUrl = `${BASE}/poppy/conversations/${id}/events?wait=10`
    const okToken = await keyring.mint({ method: 'GET', url: okUrl })
    const okRes = await GET(await get(okUrl, okToken), { params: Promise.resolve({ id }) })
    expect(okRes.status).toBe(200)
  })

  it('404 for an unknown conversation', async () => {
    const { GET } = await import('@/app/poppy/conversations/[id]/events/route')
    const url = `${BASE}/poppy/conversations/cnv_nope/events`
    const token = await keyring.mint({ method: 'GET', url })
    const res = await GET(await get(url, token), { params: Promise.resolve({ id: 'cnv_nope' }) })
    expect(res.status).toBe(404)
  })

  it('requires a valid session', async () => {
    const { GET } = await import('@/app/poppy/conversations/[id]/events/route')
    const url = `${BASE}/poppy/conversations/cnv_x/events`
    const res = await GET(await get(url, null), { params: Promise.resolve({ id: 'cnv_x' }) })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_session')
  })
})

describe('POST /poppy/conversations/{id}/handoff — Handoff (#1842)', () => {
  it('returns 202 and really flags the conversation needs_human', async () => {
    const { body: started } = await startConversation()
    const id = started.conversation_id
    const { POST } = await import('@/app/poppy/conversations/[id]/handoff/route')
    const url = `${BASE}/poppy/conversations/${id}/handoff`
    const token = await keyring.mint({ method: 'POST', url })
    const res = await POST(
      await post(url, { id: 'req_h1', message: { author: { type: 'agent' }, text: 'User needs a person.' } }, token),
      { params: Promise.resolve({ id }) },
    )
    expect(res.status).toBe(202)

    const { GET } = await import('@/app/poppy/conversations/[id]/events/route')
    const eUrl = `${BASE}/poppy/conversations/${id}/events`
    const eToken = await keyring.mint({ method: 'GET', url: eUrl })
    const events = await (await GET(await get(eUrl, eToken), { params: Promise.resolve({ id }) })).json()

    // The flag is genuinely surfaced so the agent can tell its human the truth.
    expect(events.state.needs_human).toBe(true)
    expect(events.state.status).toBe('needs_human')
    const handoff = events.events.find((e: { type: string }) => e.type === 'handoff_requested')
    expect(handoff).toBeDefined()
    expect(handoff.reason).toBe('User needs a person.')
  })

  it('stops automated doc replies once a human is requested', async () => {
    const { body: started } = await startConversation()
    const id = started.conversation_id
    const handoffMod = await import('@/app/poppy/conversations/[id]/handoff/route')
    const hUrl = `${BASE}/poppy/conversations/${id}/handoff`
    await handoffMod.POST(
      await post(hUrl, { id: 'req_h2', message: { author: { type: 'agent' }, text: 'escalate' } }, await keyring.mint({ method: 'POST', url: hUrl })),
      { params: Promise.resolve({ id }) },
    )

    const msgMod = await import('@/app/poppy/conversations/[id]/messages/route')
    const mUrl = `${BASE}/poppy/conversations/${id}/messages`
    await msgMod.POST(
      await post(mUrl, { id: 'msg_after', message: { author: { type: 'agent' }, text: 'how much does it cost?' } }, await keyring.mint({ method: 'POST', url: mUrl })),
      { params: Promise.resolve({ id }) },
    )

    const { GET } = await import('@/app/poppy/conversations/[id]/events/route')
    const eUrl = `${BASE}/poppy/conversations/${id}/events`
    const events = await (await GET(await get(eUrl, await keyring.mint({ method: 'GET', url: eUrl })), { params: Promise.resolve({ id }) })).json()
    // 2 opening + 1 handoff + 1 agent message, and NO automated reply after it.
    expect(events.events).toHaveLength(4)
    expect(events.events[3].message.author.type).toBe('agent')
  })

  it('404 for an unknown conversation', async () => {
    const { POST } = await import('@/app/poppy/conversations/[id]/handoff/route')
    const url = `${BASE}/poppy/conversations/cnv_nope/handoff`
    const token = await keyring.mint({ method: 'POST', url })
    const res = await POST(await post(url, { id: 'req_h3' }, token), { params: Promise.resolve({ id: 'cnv_nope' }) })
    expect(res.status).toBe(404)
  })
})

describe('POST /poppy/conversations/{id}/close — Close (#1842)', () => {
  it('returns 202, marks closed, and records a closed event', async () => {
    const { body: started } = await startConversation()
    const id = started.conversation_id
    const { POST } = await import('@/app/poppy/conversations/[id]/close/route')
    const url = `${BASE}/poppy/conversations/${id}/close`
    const token = await keyring.mint({ method: 'POST', url })
    const res = await POST(await post(url, { id: 'req_c1' }, token), { params: Promise.resolve({ id }) })
    expect(res.status).toBe(202)
    expect((await res.json()).conversation_id).toBe(id)

    const { GET } = await import('@/app/poppy/conversations/[id]/events/route')
    const eUrl = `${BASE}/poppy/conversations/${id}/events`
    const events = await (await GET(await get(eUrl, await keyring.mint({ method: 'GET', url: eUrl })), { params: Promise.resolve({ id }) })).json()
    expect(events.state.status).toBe('closed')
    expect(events.events.some((e: { type: string }) => e.type === 'closed')).toBe(true)
  })

  it('a closed conversation rejects further messages with 409', async () => {
    const { body: started } = await startConversation()
    const id = started.conversation_id
    const closeMod = await import('@/app/poppy/conversations/[id]/close/route')
    const cUrl = `${BASE}/poppy/conversations/${id}/close`
    await closeMod.POST(await post(cUrl, { id: 'req_c2' }, await keyring.mint({ method: 'POST', url: cUrl })), { params: Promise.resolve({ id }) })

    const msgMod = await import('@/app/poppy/conversations/[id]/messages/route')
    const mUrl = `${BASE}/poppy/conversations/${id}/messages`
    const res = await msgMod.POST(
      await post(mUrl, { id: 'msg_late', message: { author: { type: 'agent' }, text: 'hello?' } }, await keyring.mint({ method: 'POST', url: mUrl })),
      { params: Promise.resolve({ id }) },
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('conversation_closed')
  })

  it('closing an already-closed conversation is acknowledged, not an error', async () => {
    const { body: started } = await startConversation()
    const id = started.conversation_id
    const { POST } = await import('@/app/poppy/conversations/[id]/close/route')
    const url = `${BASE}/poppy/conversations/${id}/close`
    await POST(await post(url, { id: 'req_c3' }, await keyring.mint({ method: 'POST', url })), { params: Promise.resolve({ id }) })
    // A NEW request id (not an idempotent replay) on an already-closed conversation.
    const res = await POST(await post(url, { id: 'req_c4' }, await keyring.mint({ method: 'POST', url })), { params: Promise.resolve({ id }) })
    expect(res.status).toBe(202)
  })
})
