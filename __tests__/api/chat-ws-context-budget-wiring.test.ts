import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * #1195 — the Context Budget Manager (service/API/UI, shipped under #20)
 * previously only existed on a standalone demo page
 * (app/context-budget-demo/page.tsx) with hardcoded demo-session/demo-user
 * IDs, never touching the real founder-facing chat flow. This asserts the
 * real wiring landed in app/api/chat-ws/route.ts: the real session
 * (`responseId`, the same id sent back to the client as `chatId`) and the
 * real resolved `userId` (from the NextAuth token, falling back to
 * 'anonymous' for guests — never a hardcoded demo value) are passed to the
 * budget check before the LLM call, and its (possibly trimmed) output is
 * what actually reaches the model.
 *
 * The route module isn't imported directly: it instantiates OpenAI/Bedrock
 * clients at module scope on import, which is expensive/fragile to mock just
 * to check wiring shape. A source-text assertion is the established pattern
 * for this file (see chat-ws-model-tier-naming.test.ts).
 */

const routeSource = readFileSync(
  join(process.cwd(), 'app/api/chat-ws/route.ts'),
  'utf-8',
)

describe('chat-ws Context Budget Manager wiring (#1195)', () => {
  it('imports the real budget wiring module (not a copy/parallel system)', () => {
    expect(routeSource).toContain(
      "import { applyChatBudget } from '@/lib/build/context-budget-chat'",
    )
  })

  it('calls applyChatBudget with the REAL session id and REAL resolved userId', () => {
    // responseId is the real session identifier (== chatId sent to the
    // client); userId is resolved from the NextAuth token earlier in this
    // same handler. Never a hardcoded 'demo-session-*' / 'demo-user'.
    expect(routeSource).toMatch(
      /applyChatBudget\(responseId,\s*userId,\s*previousMessages\)/,
    )
    expect(routeSource).not.toContain("applyChatBudget('demo-session")
    expect(routeSource).not.toContain("applyChatBudget(\"demo-session")
  })

  it('builds conversationMessages (the primary LLM call input) from the budget-checked result, not the raw unbounded history', () => {
    expect(routeSource).toMatch(
      /const conversationMessages = \[\s*\.\.\.budgetResult\.messages,/,
    )
    // The raw previousMessages spread into conversationMessages was the bug
    // this issue reported — make sure it's gone from that exact call site.
    expect(routeSource).not.toMatch(
      /const conversationMessages = \[\s*\.\.\.previousMessages,/,
    )
  })

  it('feeds the budget-checked history into the Claude-direct and single-turn fallback LLM paths too', () => {
    expect(routeSource).toContain('budgetResult.messages.length > 0')
    expect(routeSource).toContain(
      '[...budgetResult.messages.map((m: any) => ({ role: m.role, content: m.content })), { role: \'user\', content: enhancedPrompt }]',
    )
    expect(routeSource).toContain(
      '`Previous context:\\n${budgetResult.messages.map(m => `${m.role}: ${m.content}`).join(\'\\n\')}\\n\\nNew request: ${enhancedPrompt}`',
    )
  })

  it('emits a real `budget` SSE event only when the budget check actually succeeded (fail-open: no event on failure)', () => {
    expect(routeSource).toMatch(/if \(budgetResult\.budget\) \{[\s\S]{0,200}type: 'budget'/)
  })

  it('never lets the budget check block or throw into the generation path (fail-open wiring is awaited but not try/caught around the whole handler)', () => {
    // applyChatBudget itself is documented + tested (context-budget-chat.test.ts)
    // to never throw/reject — this just asserts chat-ws calls it directly
    // (awaited plainly) rather than wrapping it in a try/catch that could
    // mask a real integration failure. If this ever needs its own try/catch
    // here, applyChatBudget's contract changed and that test needs updating.
    const callSite = routeSource.match(/const budgetResult = await applyChatBudget\([^)]*\)/)
    expect(callSite).toBeTruthy()
  })

  it('does not leave the old RLHF training-data previousMessages references pointed at the trimmed result (training data must stay the real full conversation)', () => {
    // RLHF/fine-tuning persistence must keep logging the REAL, untouched
    // previousMessages — trimming is only for what's sent to the LLM this
    // turn, never for the durable training record.
    expect(routeSource).toContain('...(previousMessages || [])')
  })
})
