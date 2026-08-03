#!/usr/bin/env node
/**
 * Pull the AINative token-usage breakdown for the account behind the builder.
 *
 * WHY: 50M/50M monthly tokens were consumed unexpectedly fast. This queries the
 * managed usage endpoint to show WHERE the tokens went (by model / endpoint /
 * day) so we can tell organic traffic from a runaway loop.
 *
 * REQUIRES an ADMIN-SCOPED token — NOT an sk_ Instant-DB/agent key.
 * Pass it via AINATIVE_ADMIN_TOKEN (never commit it, never print it).
 *
 *   AINATIVE_ADMIN_TOKEN=<admin-token> node scripts/ainative-usage-breakdown.mjs
 *
 * Optional: AINATIVE_API_URL to override base (default https://api.ainative.studio).
 */

const BASE = (process.env.AINATIVE_API_URL || 'https://api.ainative.studio') + '/v1'
const TOKEN = process.env.AINATIVE_ADMIN_TOKEN

if (!TOKEN) {
  console.error('❌ AINATIVE_ADMIN_TOKEN is not set. Provide an admin-scoped token (not an sk_ key).')
  process.exit(1)
}
if (TOKEN.startsWith('sk_')) {
  console.error('❌ That looks like an sk_ Instant-DB/agent key. Use a proper admin-scoped token instead.')
  process.exit(1)
}

const headers = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers })
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body }
}

const ENDPOINTS = [
  '/managed/usage?period=month',
  '/managed/usage?period=month&group_by=model',
  '/managed/usage?period=month&group_by=day',
  '/managed/usage?period=month&group_by=api_key',
  '/public/billing',
  '/subscription',
]

console.log(`\nAINative usage breakdown — ${BASE}\n${'='.repeat(60)}`)
for (const ep of ENDPOINTS) {
  const { status, body } = await get(ep)
  console.log(`\n### GET ${ep}  →  HTTP ${status}`)
  console.log(typeof body === 'string' ? body.slice(0, 2000) : JSON.stringify(body, null, 2).slice(0, 4000))
}
console.log(`\n${'='.repeat(60)}\nLook for: which model/api_key/day dominates the 50M. A single key or a`)
console.log(`single day spiking = runaway loop or leaked key, not organic user traffic.\n`)
