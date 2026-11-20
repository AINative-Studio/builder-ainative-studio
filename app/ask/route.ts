/**
 * GET/POST /ask (#2170, AX/agent-readiness scan 2026-11-19) — NLWeb-convention
 * conversational-search endpoint (nlweb.ai spec) at the standard ROOT path.
 *
 * #1679 already built the real, grounded answer logic and exposed it at
 * `/api/ask` — but the NLWeb spec (and every scanner following it) looks for
 * `/ask` at the site root, not under `/api/`. `lib/agent-markdown-negotiation
 * .ts`'s `homepageMarkdown()` has referenced `${SITE}/ask` since it was
 * written; this route is what finally makes that link real.
 *
 * `/api/ask` (#1679) is INTENTIONALLY left as its own separate, unchanged
 * route (same flat `{answer, sources, model, provider}` shape its own tests
 * already pin) — this file does not forward to or replace it, since
 * reshaping that response would break its existing contract/tests for no
 * reason. Both routes independently call `/api/build/help`'s POST handler
 * (curated FAQ + Claude/AINative fallback) as the single real grounding
 * logic — see that route for the actual retrieval/model implementation.
 * This file is purely a second, NLWeb-shaped presentation of the same
 * underlying answer.
 *
 * NLWeb response shape: `{ _meta, results, answer }` — distinct from #1679's
 * original flat `{ answer, sources, model, provider }`. `_meta` carries
 * request provenance (query, timestamp); `results` maps the real FAQ
 * citations `/api/build/help` already returns as `sources` into NLWeb-shaped
 * result items (so this is a presentation change, not a new retrieval path);
 * `answer` is the same real, grounded answer text either way.
 *
 * GET supports two modes:
 *   - `Accept: text/event-stream` → SSE: a single `result` event per citation
 *     (as they'd be known, instantly — this is not a token-by-token LLM
 *     stream, since the underlying grounding call is request/response), then
 *     one `answer` event, then `done`. Real NLWeb clients expect a streaming
 *     endpoint to behave like a stream even when the upstream work is a
 *     single round trip — this still gives an SSE consumer well-formed,
 *     incrementally-delivered events rather than forcing it to buffer a
 *     whole response.
 *   - otherwise → a single JSON response, same shape, non-streamed.
 * POST always returns the single JSON response (streaming is a GET-only
 * convention here — NLWeb's own examples stream via GET+SSE).
 */

import { NextRequest } from 'next/server'
import { POST as helpPost } from '@/app/api/build/help/route'

export const runtime = 'nodejs'

interface NlwebResult {
  '@type': 'Question'
  url: string
  name: string
}

interface NlwebResponse {
  _meta: { query: string; timestamp: string }
  results: NlwebResult[]
  answer: string
}

const SITE = 'https://builder.ainative.studio'

/** Run the real grounded-answer logic and shape it as an NLWeb response. */
async function groundedAsk(question: string): Promise<NlwebResponse> {
  const helpRes = await helpPost({ json: async () => ({ question }) } as NextRequest)
  const body = await helpRes.json().catch(() => ({}))
  const sources: Array<{ id?: string; question?: string }> = Array.isArray(body?.sources) ? body.sources : []
  return {
    _meta: { query: question, timestamp: new Date().toISOString() },
    results: sources.map((s) => ({
      '@type': 'Question',
      url: s?.id ? `${SITE}/help#${s.id}` : SITE,
      name: String(s?.question || ''),
    })),
    answer: String(body?.answer || ''),
  }
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

async function streamingResponse(question: string): Promise<Response> {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const res = await groundedAsk(question)
        controller.enqueue(encoder.encode(sseEvent('meta', res._meta)))
        for (const result of res.results) {
          controller.enqueue(encoder.encode(sseEvent('result', result)))
        }
        controller.enqueue(encoder.encode(sseEvent('answer', { answer: res.answer })))
      } catch (e: any) {
        controller.enqueue(encoder.encode(sseEvent('error', { error: e?.message || 'unavailable' })))
      } finally {
        // Always a terminal `done` event, success or failure — an SSE
        // consumer should never have to distinguish "the stream ended
        // because it finished" from "the stream ended because the
        // connection dropped" by the absence of a signal.
        controller.enqueue(encoder.encode(sseEvent('done', { done: true })))
        controller.close()
      }
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

function wantsStream(request: NextRequest): boolean {
  const accept = request.headers.get('accept') || ''
  return accept.toLowerCase().includes('text/event-stream')
}

export async function GET(request: NextRequest) {
  const question = (request.nextUrl.searchParams.get('query') || request.nextUrl.searchParams.get('question') || '').trim()
  if (!question) {
    return Response.json({ error: 'query required' }, { status: 400 })
  }
  if (wantsStream(request)) {
    return streamingResponse(question)
  }
  const res = await groundedAsk(question)
  return Response.json(res)
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const question = String(body?.query ?? body?.question ?? '').trim()
  if (!question) {
    return Response.json({ error: 'query required' }, { status: 400 })
  }
  const res = await groundedAsk(question)
  return Response.json(res)
}
