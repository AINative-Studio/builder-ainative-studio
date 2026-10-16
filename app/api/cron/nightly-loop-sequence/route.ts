/**
 * Nightly loop sequencer (#1110) — replaces the GitHub Actions matrix as the
 * nightly loop's trigger. Railway's native `cronSchedule` hits this ONE route,
 * which then calls all 4 shards of /api/build/nightly-loop ONE AT A TIME.
 *
 * WHY: the GitHub Actions matrix fired all 4 shards within <1s of each other.
 * Each shard independently runs up to NIGHTLY_COMPANY_CONCURRENCY (8) parallel
 * per-company pipelines — real LLM calls, swarm dispatch, coverage runs — so
 * up to 32 concurrent heavy operations hit the SAME single Railway instance
 * (builder-ainative-studio runs numReplicas: 1) at once. Confirmed live across
 * four separate nights: Railway's proxy 502'd on 1-2 of the 4 simultaneous
 * top-level requests per night, with the failing shard combination different
 * every time (0+1, 2+3, 0+2, 1+2) — ruling out a shard-index-specific bug and
 * confirming this is pure concurrent-load contention on one instance.
 *
 * FIX: call the 4 shards sequentially, with a short delay between each, so
 * peak concurrent load on the instance drops ~4x. Each shard call still has
 * its own generous timeout; a slow or failed shard does not block the next
 * one (fail-fast: false, same contract the old Actions matrix had).
 *
 * SAFETY: same CRON_SECRET bearer-auth pattern as every other /api/cron/*
 * route. This route calls the EXISTING, unmodified nightly-loop route over
 * HTTP (not an in-process import) so each shard keeps its own real request
 * lifecycle/timeout — identical behavior to the old external caller, just
 * sequenced instead of parallel.
 *
 * PRIVATE NETWORKING (found live, 2026-10-16): calling the service's own
 * PUBLIC domain (request.url's origin) from server-side fetch() failed fast
 * with a bare "fetch failed" on every shard — not a timeout, an immediate
 * connection-level error — even though the exact same request from curl
 * outside the container worked (eventually). The request still reached the
 * handler server-side (confirmed via "Nightly autonomous loop starting" in
 * the logs), so the self-referential round trip through Railway's public
 * edge back into the same container is the unreliable part, not the route's
 * own logic. Fix: call RAILWAY_PRIVATE_DOMAIN instead — Railway's internal
 * network, bypassing the public edge entirely for this server-to-server hop.
 */

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const SHARD_COUNT = 4
// Headroom between shard calls so one shard's tail (DB writes, response
// serialization) finishes draining before the next shard's burst of
// concurrent per-company work begins.
function envMs(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

const INTER_SHARD_DELAY_MS = envMs('NIGHTLY_LOOP_SHARD_DELAY_MS', 15_000)
// Each shard call gets its own timeout, generous enough for the shard's own
// internal budget (NIGHTLY_LOOP_BUDGET_MS, default 210s) plus response
// overhead, same margin the old Action's --max-time 420 gave it.
const SHARD_TIMEOUT_MS = envMs('NIGHTLY_LOOP_SHARD_TIMEOUT_MS', 240_000)

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface ShardOutcome {
  shard: number
  ok: boolean
  status?: number
  body?: unknown
  error?: string
}

function timeoutAfter(ms: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(`shard timed out after ${ms}ms`)), ms))
}

async function runShard(baseUrl: string, cronSecret: string, shard: number): Promise<ShardOutcome> {
  const url = `${baseUrl}/api/build/nightly-loop?shard=${shard}&shards=${SHARD_COUNT}`
  try {
    const res = await Promise.race([
      fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cronSecret}` },
      }),
      timeoutAfter(SHARD_TIMEOUT_MS),
    ])
    const body = await res.json().catch(() => null)
    return { shard, ok: res.ok, status: res.status, body }
  } catch (error) {
    // A single shard's network failure or timeout must never abort the
    // remaining shards — the whole point of sequencing is that one shard's
    // bad night (a 502, a timeout) can't take the others down with it, same
    // as the old matrix's fail-fast: false.
    return { shard, ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    logger.warn('Unauthorized nightly-loop-sequence cron request', {
      path: '/api/cron/nightly-loop-sequence',
      ip: request.headers.get('x-forwarded-for') || 'unknown',
    })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  // Prefer Railway's private internal domain (service-to-service, no public
  // edge hop) over the request's own public origin — see PRIVATE NETWORKING
  // above. The private network routes to whatever port this same process is
  // actually listening on (next start -p ${PORT:-3000}, see package.json),
  // which Railway injects as process.env.PORT at runtime.
  const privateDomain = process.env.RAILWAY_PRIVATE_DOMAIN
  const port = process.env.PORT || '3000'
  const baseUrl = privateDomain ? `http://${privateDomain}:${port}` : new URL(request.url).origin
  const startedAt = Date.now()
  const outcomes: ShardOutcome[] = []

  for (let shard = 0; shard < SHARD_COUNT; shard++) {
    if (shard > 0) await sleep(INTER_SHARD_DELAY_MS)
    const outcome = await runShard(baseUrl, cronSecret, shard)
    outcomes.push(outcome)
    logger.info('Nightly loop shard completed', {
      shard,
      ok: outcome.ok,
      status: outcome.status,
      error: outcome.error,
    })
  }

  const failed = outcomes.filter((o) => !o.ok)
  return NextResponse.json({
    ok: failed.length === 0,
    elapsedMs: Date.now() - startedAt,
    shards: outcomes,
    failedShards: failed.map((o) => o.shard),
  })
}

// Allow POST as well for manual triggers, same convention as the other
// /api/cron/* routes.
export async function POST(request: NextRequest) {
  return GET(request)
}
