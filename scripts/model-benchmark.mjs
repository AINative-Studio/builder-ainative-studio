#!/usr/bin/env node
/**
 * Model benchmark for Cody codegen (builder#306).
 *
 * Generates the same idea suite across the Claude models now available via the
 * AINative API (Bedrock channel) and scores each generation on quality + latency +
 * cost, so we can pick the best model per COMPLEXITY TIER. Objective: quality-first,
 * cost as tiebreak (per product decision 2026-08-26).
 *
 * Quality metrics mirror the codegen validators already in the app:
 *   valid (parses), dbBacked (/api/db), aikit (uses AIKit), multiFile (>1 src file),
 *   sourceFiles, interactive (handlers). We call the model DIRECTLY (not through
 *   /api/chat-ws) so we measure the MODEL, not the full pipeline — the decomposition/
 *   obedience passes are pipeline features, not model quality.
 *
 * Usage:
 *   AINATIVE_API_KEY=... node scripts/model-benchmark.mjs
 *   BENCH_MODELS="claude-sonnet-4.5,claude-sonnet-4.6" node scripts/model-benchmark.mjs
 */

const API = (process.env.AINATIVE_API_URL || 'https://api.ainative.studio') + '/v1/chat/completions'
const KEY = process.env.AINATIVE_API_KEY || process.env.ZERODB_API_KEY || ''

// The 4 Claude models now available via Bedrock (+ override via BENCH_MODELS).
const MODELS = (process.env.BENCH_MODELS ||
  'claude-sonnet-4.5,claude-sonnet-4.6,claude-opus-4.5,claude-opus-4.6').split(',').map(s => s.trim())

// Idea suite by complexity tier — the tier is what auto-select keys off.
const SUITE = [
  { tier: 'simple',  name: 'counter',   idea: 'a counter app with increment/decrement and a live count' },
  { tier: 'simple',  name: 'tip',       idea: 'a tip calculator with bill amount, tip %, and split' },
  { tier: 'medium',  name: 'todo',      idea: 'a todo list to add, complete, and delete tasks that persist' },
  { tier: 'medium',  name: 'notes',     idea: 'a notes app to create, edit, and save notes' },
  { tier: 'complex', name: 'crm',       idea: 'a CRM with a sidebar, contacts table, deal pipeline kanban, activity feed, and reports page with charts' },
  { tier: 'complex', name: 'dashboard', idea: 'an analytics dashboard with a sidebar, metric cards, a line chart, a data table, and a settings page' },
  { tier: 'complex', name: 'ecommerce', idea: 'an online store with a product grid, product cards, a shopping cart, and a checkout page' },
]

const AIKIT = ['MetricCard','AIKitSidebar','AIKitHeader','AIKitTable','AIKitProductCard','AIKitTimeline','AIKitBanner','AIKitPagination','AIKitRating']

// Approx Bedrock $/1M tokens (blended in/out) for cost-as-tiebreak. Update as needed.
const COST_PER_MTOK = {
  'claude-sonnet-4.5': 9.0, 'claude-sonnet-4.6': 9.0,
  'claude-opus-4.5': 45.0, 'claude-opus-4.6': 45.0,
}

const SYSTEM = 'You are an expert React app builder. Return ONE complete, working React app. ' +
  'Persist real data via fetch to /api/db/{table}. Use AIKit components (MetricCard, AIKitSidebar, ' +
  'AIKitTable, AIKitProductCard, …) instead of hand-rolling. For complex apps, split into multiple ' +
  'files using "// --- FILE: src/App.tsx ---" markers. Return ONLY code.'

function scoreCode(raw) {
  const markers = (raw.match(/\/\/\s*---\s*FILE:\s*([^\n]+?)\s*---/g) || [])
    .map(m => m.replace(/\/\/\s*---\s*FILE:\s*/, '').replace(/\s*---/, '').trim())
    .filter(f => /\.(t|j)sx?$/.test(f) && !/robots|sitemap|layout|manifest/.test(f))
  const srcFiles = markers.length || 1
  return {
    valid: /export default|function App|const App/.test(raw) && raw.length > 300,
    dbBacked: /\/api\/db\//.test(raw),
    aikit: AIKIT.some(c => new RegExp(`<${c}[\\s/>]`).test(raw)),
    interactive: /onClick=|onChange=|onSubmit=/.test(raw),
    multiFile: srcFiles > 1,
    sourceFiles: srcFiles,
    bytes: raw.length,
  }
}

async function genOne(model, idea) {
  const t0 = Date.now()
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: 8192,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: `Build: ${idea}` }],
    }),
  })
  const ms = Date.now() - t0
  if (!res.ok) return { error: `HTTP ${res.status}`, ms }
  const data = await res.json()
  const raw = data.choices?.[0]?.message?.content || ''
  const usage = data.usage || {}
  const toks = (usage.prompt_tokens || 0) + (usage.completion_tokens || 0)
  const cost = (toks / 1e6) * (COST_PER_MTOK[model] || 0)
  return { ...scoreCode(raw), ms, tokens: toks, costUsd: +cost.toFixed(4) }
}

;(async () => {
  if (!KEY) { console.error('Set AINATIVE_API_KEY'); process.exit(1) }
  const rows = []
  for (const model of MODELS) {
    for (const t of SUITE) {
      process.stderr.write(`${model} / ${t.name}...\n`)
      let r
      try { r = await genOne(model, t.idea) } catch (e) { r = { error: String(e).slice(0, 60) } }
      rows.push({ model, tier: t.tier, idea: t.name, ...r })
    }
  }
  // Per model × tier aggregate (quality-first).
  const agg = {}
  for (const r of rows) {
    const k = `${r.model}|${r.tier}`
    agg[k] ||= { model: r.model, tier: r.tier, n: 0, valid: 0, aikit: 0, multiFile: 0, dbBacked: 0, ms: 0, cost: 0 }
    const a = agg[k]; a.n++
    if (r.valid) a.valid++; if (r.aikit) a.aikit++; if (r.multiFile) a.multiFile++
    if (r.dbBacked) a.dbBacked++; a.ms += r.ms || 0; a.cost += r.costUsd || 0
  }
  console.log('\nmodel                tier     n  valid aikit multiF dbBack  avgMs   $tot')
  for (const a of Object.values(agg)) {
    const pct = x => `${Math.round(100 * x / a.n)}%`.padStart(5)
    console.log(
      `${a.model.padEnd(20)} ${a.tier.padEnd(8)} ${a.n}  ${pct(a.valid)} ${pct(a.aikit)} ${pct(a.multiFile)} ${pct(a.dbBacked)} ${String(Math.round(a.ms/a.n)).padStart(6)} ${a.cost.toFixed(3).padStart(6)}`
    )
  }
  console.log('\nRAW_JSON=' + JSON.stringify(rows))
})()
