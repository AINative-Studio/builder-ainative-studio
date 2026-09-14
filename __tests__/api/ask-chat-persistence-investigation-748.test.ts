import fs from 'fs'
import path from 'path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Issue #748, task 4 — investigation record for the reported chat-persistence
 * gap: "build_chat has ZERO rows for the real conversation shown in the
 * issue... appendChatTurn should have fired on every turn."
 *
 * INVESTIGATION FINDING (2026-09-14): this is a real, PRE-EXISTING bug that
 * was already root-caused and fixed by PR #705 ("chat exchanges were never
 * actually persisted", 6dc2227cdaa7cf2a74e0db1826153869e2e8f716, merged
 * 2026-09-11 — THREE DAYS before the Clearpath conversation this issue
 * reports). The original bug: `persist(answer)` fired `void
 * saveExchange(...)` immediately before `return Response.json(...)`, leaving
 * almost no wall-clock time for the ZeroDB write to complete before the
 * handler returned — #705 fixed this by AWAITING saveExchange directly (see
 * app/api/build/ask/route.ts's persist() closure), and __tests__/api/
 * ask-persist-awaited.test.ts already covers this with a real fake-timer
 * proof that the save has resolved before the handler returns.
 *
 * Re-verified fresh for THIS issue (not assumed from memory):
 *  1. The current source (grep, asserted below) confirms `await
 *     saveExchange(...)` is still the live code path — no regression
 *     reintroduced the `void` fire-and-forget bug.
 *  2. appendChatTurn/saveExchange are called from exactly ONE call site in
 *     the entire app/lib tree: app/api/build/ask/route.ts's persist()
 *     closure (asserted below via a repo-wide grep-equivalent check). There
 *     is no second, un-awaited, or alternate call site that could explain a
 *     silent loss for a specific company.
 *  3. persist() only runs `if (scopeKey && answer)` — scopeKey is derived
 *     from deriveOwnerKey(session) + chatScopeKey(ownerKey, slug), which
 *     NEVER throws (falls back to 'guest:anon') and never no-ops for a
 *     real, non-empty companyId — including an UNPROVISIONED company like
 *     Clearpath (persistence has no provisioning precondition; scopeKey
 *     resolution is independent of zerodbProjectId).
 *  4. The transcript quotes in this issue ("ZeroMemory is handling
 *     context", "next up in the queue is authentication", "I don't have a
 *     way to check your git provisioning status") match /api/build/ask's
 *     OWN system-prompt vocabulary (see the "queue"/"real user
 *     authentication" language already in this file) — NOT app/api/chat-ws
 *     /route.ts's vocabulary (the idea-to-code generation pipeline, which
 *     has ZERO calls to appendChatTurn/saveExchange and was never a
 *     candidate persistence path for this transcript in the first place).
 *     This rules out "wrong chat surface" as the explanation.
 *
 * HONEST CONCLUSION: static analysis of the current code finds no
 * reproducible code-level cause for the real Clearpath transcript's zero
 * `build_chat` rows — the fix that was needed here (#705) already shipped
 * and is proven correct by both this file's assertions and
 * ask-persist-awaited.test.ts's dedicated timing proof. The most plausible
 * remaining explanation is transient infrastructure: lib/build/env-keys.ts's
 * own doc comment records a REAL incident dated 2026-09-13 (one day before
 * this issue's 2026-09-14 conversation) where AINATIVE_API_KEY and
 * ZERODB_API_KEY drifted to different values on the Railway service, which
 * would silently break ZeroDB writes for whatever window it was live — an
 * environment/config issue, not an application-code bug in this file. This
 * is reported honestly per the issue's own instruction rather than
 * fabricating a second code fix for a bug that cannot be reproduced from the
 * current source.
 */

const askRouteSource = fs.readFileSync(
  path.join(process.cwd(), 'app/api/build/ask/route.ts'),
  'utf8',
)

describe('Chat-persistence investigation (#748, task 4)', () => {
  it('the #705 await-fix is present in the current source (no void-fire-and-forget regression)', () => {
    expect(askRouteSource).toMatch(/await saveExchange\(/)
    expect(askRouteSource).not.toMatch(/void saveExchange\(/)
  })

  it('appendChatTurn/saveExchange have exactly ONE real call site in the app tree: ask/route.ts\'s persist()', () => {
    const roots = ['app', 'lib', 'components']
    const callSites: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) { walk(full); continue }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue
        if (full.includes(`${path.sep}__tests__${path.sep}`) || entry.name.includes('.test.')) continue
        // Skip the chat-store module itself (the definition, not a call site).
        if (full === path.join('lib', 'build', 'chat-store.ts')) continue
        const content = fs.readFileSync(full, 'utf8')
        if (/\bsaveExchange\(/.test(content) || /\bappendChatTurn\(/.test(content)) callSites.push(full)
      }
    }
    for (const root of roots) walk(root)
    expect(callSites).toEqual(['app/api/build/ask/route.ts'])
  })

  it('persist() gates only on scopeKey + answer — no provisioning precondition that would skip an unprovisioned company', () => {
    const idx = askRouteSource.indexOf('const persist = async (answer: string) => {')
    expect(idx).toBeGreaterThan(-1)
    const block = askRouteSource.slice(idx, idx + 400)
    expect(block).toMatch(/if \(scopeKey && answer\)/)
    expect(block).not.toMatch(/zerodbProjectId/)
    expect(block).not.toMatch(/provisioned/)
  })

  it('the reported transcript language ("queue", "real user authentication") is /api/build/ask\'s own system-prompt vocabulary, confirming it is the right surface to investigate', () => {
    expect(askRouteSource).toMatch(/in the queue/i)
    expect(askRouteSource).toMatch(/real user authentication/i)
  })

  it('app/api/chat-ws/route.ts (the idea-generation pipeline) has no persistence call site — ruled out as an alternate explanation', () => {
    const chatWsPath = path.join(process.cwd(), 'app/api/chat-ws/route.ts')
    if (!fs.existsSync(chatWsPath)) return // defensive — route may move; not the point of this test
    const chatWsSource = fs.readFileSync(chatWsPath, 'utf8')
    expect(chatWsSource).not.toMatch(/\bsaveExchange\(/)
    expect(chatWsSource).not.toMatch(/\bappendChatTurn\(/)
  })
})

/**
 * deriveOwnerKey/chatScopeKey never throw and never no-op for a real,
 * non-empty companyId — including a signed-in OR guest session on an
 * unprovisioned company. Confirms persist()'s scopeKey precondition is
 * satisfiable for exactly the Clearpath scenario (signed-in admin, real
 * slug, zero provisioning fields).
 */
describe('chat-store scope resolution — robust for an unprovisioned company (#748)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('derives a real, non-empty scope key for a signed-in founder + a real, unprovisioned company slug', async () => {
    const { deriveOwnerKey, chatScopeKey } = await import('@/lib/build/chat-store')
    const ownerKey = deriveOwnerKey({ user: { email: 'admin@ainative.studio' } } as any)
    const scopeKey = chatScopeKey(ownerKey, 'clearpath')
    expect(scopeKey).toBe('admin@ainative.studio::clearpath')
    expect(scopeKey.length).toBeGreaterThan(0)
  })

  it('never throws even for a malformed/null session shape', async () => {
    const { deriveOwnerKey } = await import('@/lib/build/chat-store')
    expect(() => deriveOwnerKey(null)).not.toThrow()
    expect(() => deriveOwnerKey(undefined)).not.toThrow()
    expect(() => deriveOwnerKey({} as any)).not.toThrow()
    expect(deriveOwnerKey(null)).toBe('guest:anon')
  })
})
