import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * Issue #760 — real user report: Cody's response text visibly rendered
 * overlapping/bleeding into the "WHAT CODY HAS LEARNED" summary card right
 * when a reply arrived. Root cause investigation found the hand-rolled
 * `<p className="m-chat-cody">` rendering plus a manual chatLogRef scroll
 * effect racing against React's own layout/paint timing.
 *
 * Fix: Cody's response turns (and the in-flight "thinking…" placeholder) now
 * render through @ainative/ai-kit's real StreamingMessage component instead
 * of a raw <p>. Scope is RENDERING ONLY — Builder's chat/ChatLine state,
 * /api/build/ask's single-JSON-response contract, and chat-store.ts's
 * persistence are all unchanged (see the issue's non-negotiable constraints).
 *
 * These are source-level assertions (matching this repo's existing pattern
 * for Live.tsx — e.g. live-provisioning-banner.test.ts — since Live.tsx pulls
 * in heavy context/hook dependencies that make full rendering impractical
 * here); the real, deployed behavior is verified separately via Playwright
 * (e2e/live-chat-aikit-overlap.spec.ts) and live browser screenshots.
 */
describe('Live chat — Cody responses render via @ainative/ai-kit StreamingMessage (#760)', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'components/build/screens/Live.tsx'),
    'utf8',
  )

  it('imports StreamingMessage from @ainative/ai-kit', () => {
    expect(source).toMatch(/import\s*{\s*StreamingMessage\s*}\s*from\s*'@ainative\/ai-kit'/)
  })

  it('renders each historical Cody turn through StreamingMessage with role="assistant" and streamingState="complete"', () => {
    const idx = source.indexOf('chat.map((line, i) =>')
    expect(idx).toBeGreaterThan(-1)
    const block = source.slice(idx, idx + 1200)
    expect(block).toMatch(/<StreamingMessage/)
    expect(block).toMatch(/role="assistant"/)
    expect(block).toMatch(/content=\{line\.text\}/)
    expect(block).toMatch(/streamingState="complete"/)
  })

  it('the live in-flight placeholder uses StreamingMessage with streamingState="streaming", not the historical "complete" state', () => {
    const idx = source.indexOf('{asking && (')
    expect(idx).toBeGreaterThan(-1)
    const block = source.slice(idx, idx + 700)
    expect(block).toMatch(/<StreamingMessage/)
    expect(block).toMatch(/streamingState="streaming"/)
    expect(block).toMatch(/thinking…/)
  })

  it('markdown rendering is explicitly disabled — the system prompt at /api/build/ask promises "PLAIN TEXT ONLY"', () => {
    const idx = source.indexOf('chat.map((line, i) =>')
    const block = source.slice(idx, idx + 1200)
    expect(block).toMatch(/enableMarkdown=\{false\}/)
  })

  it('a style override is passed to neutralize StreamingMessage\'s own card chrome (background/border/padding), so Builder\'s modernist.css controls the look', () => {
    expect(source).toMatch(/AIKIT_MESSAGE_STYLE_OVERRIDE/)
    const styleIdx = source.indexOf('const AIKIT_MESSAGE_STYLE_OVERRIDE')
    expect(styleIdx).toBeGreaterThan(-1)
    const styleBlock = source.slice(styleIdx, styleIdx + 500)
    expect(styleBlock).toMatch(/background:\s*'transparent'/)
    expect(styleBlock).toMatch(/padding:\s*0/)
  })

  it('user turns keep Builder\'s own existing rendering (m-chat-user/m-chat-user-turn), unchanged by the AIKit swap', () => {
    expect(source).toMatch(/className="m-chat-user-turn"/)
    expect(source).toMatch(/className="m-chat-user"/)
    // The user branch must NOT be routed through StreamingMessage.
    const userIdx = source.indexOf("line.role === 'user'")
    const codyIdx = source.indexOf(': (', userIdx)
    const userBlock = source.slice(userIdx, codyIdx)
    expect(userBlock).not.toMatch(/StreamingMessage/)
  })

  it('#741 chat attachments still render inside the user turn, untouched by the AIKit swap', () => {
    const userIdx = source.indexOf("line.role === 'user'")
    const codyIdx = source.indexOf(': (', userIdx)
    const userBlock = source.slice(userIdx, codyIdx)
    expect(userBlock).toMatch(/data-testid="chat-sent-attachments"/)
    expect(userBlock).toMatch(/line\.attachments/)
  })

  it('the manual chatLogRef scroll-to-bottom effect is KEPT — StreamingMessage only scrolls itself into view while streamingState is "streaming" (verified against the installed package source), so it never re-fires once a historical/completed answer replaces the placeholder', () => {
    expect(source).toMatch(/const chatLogRef = useRef<HTMLDivElement>\(null\)/)
    expect(source).toMatch(/chatLogRef\.current\?\.scrollTo\(\{ top: chatLogRef\.current\.scrollHeight \}\)/)
  })

  it('the chat log container still owns real overflow/scroll (never relies on StreamingMessage for the outer container)', () => {
    const cssPath = path.join(process.cwd(), 'app/modernist.css')
    const css = fs.readFileSync(cssPath, 'utf8')
    const idx = css.indexOf('.m-chat-log {')
    expect(idx).toBeGreaterThan(-1)
    expect(css.slice(idx, idx + 200)).toMatch(/overflow-y:\s*auto/)
  })
})
