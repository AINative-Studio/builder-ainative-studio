# Using the REAL AIKit components (not the thin stubs)

## The problem the user identified

Generated dashboards don't look as clean as the AIKit design-system pages
(`/ai-kit/dashboard`, `/ai-kit/agents` swarms, `/ai-kit/streaming`,
`/ai-kit/safety`, `/ai-kit/video`, `/ai-kit/a2ui`). Root cause: the builder's
preview renderers use **hand-written stub reimplementations** of AIKit
(`lib/sandpack/aikit-bundle.ts` — ~30 minimal components) instead of the real,
production-ready components published on npm.

## What actually exists on npm (verified)

The full `@ainative/*` AIKit ecosystem is published:

| Package | Version | What it is | Sandpack-safe? |
|---|---|---|---|
| **`@ainative/ai-kit`** | 0.2.0 | **React components + hooks** (streaming/agents) | ✅ yes (peer: react only) |
| `@ainative/ai-kit-core` | 0.2.0 | framework-agnostic core (streaming/agents/state) | ✅ (logic) |
| `@ainative/ai-kit-video` | 0.1.3 | video recording/transcription utils | ⚠️ needs media APIs |
| `@ainative/ai-kit-safety` | 0.1.1 | prompt-injection / PII / moderation LOGIC | ⚠️ not UI |
| `@ainative/ai-kit-observability` | 0.1.1 | usage/cost tracking LOGIC | ⚠️ not UI |
| `@ainative/ai-kit-rlhf` | 0.1.2 | RLHF integration LOGIC | ⚠️ not UI |
| `@ainative/ai-kit-zerodb` | — | ZeroDB client | ✅ |
| `@ainative/ai-kit-nextjs` / `-svelte` / `-vue` | — | framework adapters | — |
| `@ainative/ai-kit-design-system` | 0.1.1 | design tokens + MCP integration (4.6 kB) | tokens only |

### Real components in `@ainative/ai-kit@0.2.0` (verified from its .d.ts)
Components: `AgentResponse`, `CodeBlock`, `MarkdownRenderer`, `ProgressBar`,
`StreamingIndicator`, `StreamingMessage`, `StreamingToolResult`, `ToolResult`,
`UnknownTool`, `ComponentRegistry`.
Hooks: `useAIStream`, `useConversation`, `useComponentRegistry`.

## Important nuance (don't over-promise)

- `@ainative/ai-kit` gives the **streaming + agent + tool-result** components —
  these directly map to `/ai-kit/streaming` and `/ai-kit/agents`. Swapping these
  in is a clear, high-value win.
- The **safety / observability / rlhf** packages are **logic**, not the polished
  dashboard UI. The gorgeous dashboards on the design-system pages are almost
  certainly **custom layouts composed from primitives + design tokens**, not one
  importable `<Dashboard>`/`<SwarmView>`. So "just import the real SwarmView"
  isn't available as a drop-in for those — the clean look there comes from the
  **design tokens + Tailwind theme + composition patterns**, which is what the
  builder should adopt.

## Recommended plan (two tracks)

### Track A — swap real components into the Sandpack renderer (high value, medium effort)
1. Add `@ainative/ai-kit@^0.2.0` (and `@ainative/ai-kit-core`) to the Sandpack
   `customSetup.dependencies` in `components/chat/sandpack-preview.tsx` (Sandpack
   installs from npm at runtime — no builder bundle change).
2. For the components the real package provides (StreamingMessage,
   StreamingIndicator, CodeBlock, MarkdownRenderer, AgentResponse, ProgressBar,
   ToolResult), **delete the stub versions** from `aikit-bundle.ts` and let the
   real package resolve. Update the jsx-fixer/import rules to import these from
   `@ainative/ai-kit` instead of `./components/aikit`.
3. Keep hand-stubs ONLY for names the real package doesn't export
   (MetricCard, SwarmView, AIKitSidebar, GuardrailPanel, etc.) — but upgrade
   those stubs to match the design-system look (see Track B).

### Track B — match the polished look via design tokens (the real "clean" lever)
The dashboards look clean because of the **design tokens + theme**, not magic
components. Pull them in:
1. `@ainative/ai-kit-design-system` exposes the tokens (+ an MCP server already
   connected to this session: `mcp__ainative-design__extractDesignTokens`,
   `generateTheme`, `createStyleGuide`).
2. Bake the AIKit color/spacing/radius/typography tokens into the Sandpack
   Tailwind config + the stub components, so even the hand-stubbed components
   (MetricCard, SwarmView) inherit the design-system's glassmorphism, spacing,
   and gradient-text polish.
3. Feed the token palette into the generation prompt's DESIGN RULES so the model
   produces on-brand layouts by default.

### Also verify (this session already started)
- Preview iframe interactivity: fixed sandbox to `allow-forms allow-modals
  allow-popups` (PR #120) so buttons/inputs/forms actually work.

## Effort / risk
- Track A step 1 (add deps to Sandpack) is low-risk and testable in an afternoon —
  Sandpack just npm-installs them. Biggest unknown: whether every real component
  renders cleanly in Sandpack's bundler (some may pull heavy transitive deps).
- Track B (tokens/theme) is the highest-leverage for "looks as clean as the
  design system" and is mostly config + prompt, low code risk.

## Suggested first step
Prototype Track A step 1: add `@ainative/ai-kit` to Sandpack deps, generate a
streaming-chat app, and confirm the REAL `StreamingMessage`/`CodeBlock` render.

**VERIFIED unblocked:** inspected `@ainative/ai-kit@0.2.0`'s `dist/index.mjs` —
it imports ONLY `react`, `react-markdown`, `react-syntax-highlighter`,
`remark-gfm`, `@ainative/ai-kit-core` (all browser-safe). No node builtins, no
`next`, no `use server`. Sandpack can npm-install and bundle it as-is. So the
swap-in for the streaming/agent components has no runtime blocker — it's a
`customSetup.dependencies` addition + a stub deletion + an import-path update.
