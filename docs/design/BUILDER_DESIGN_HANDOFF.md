# AINative Builder — Design Handoff for Claude Design

**Date:** 2026-07-18
**Prepared by:** Engineering
**Product:** AINative Builder (`builder.ainative.studio`)
**Purpose:** Complete specification of the product's backend, API surface, current UI/flow, and AINative primitive integrations — so Claude Design can propose a **totally different UI/UX** on top of the same proven backend. Cody remains the lead agent persona.

> **How to use this doc:** The backend and data contracts below are stable and should be treated as fixed capabilities. Design is free to reinvent the entire front-end experience, information architecture, and interaction model — as long as it consumes these same endpoints and streams. Where the current UI is described, treat it as "what exists today," not "what must remain."

---

## 1. What the Product Is

AINative Builder is an **AI app-generation platform** — a user types a prompt ("Build a weather dashboard…") and the product generates a working React application and renders it live in an in-browser preview. It is positioned as a v0 / Lovable / Bolt alternative, differentiated by being **agent-native** and built entirely on the **AINative primitive stack** (ZeroDB, ZeroMemory, AIKit, the agent runtime, and the recursive intelligence loop).

**Lead agent persona:** **Cody** — the seasoned engineering lead who orchestrates generation, delegates to subagents, and narrates build steps. Cody's voice/persona should remain the through-line of any new UX.

**Core user journeys:**
1. **Generate** — prompt → streamed build → live preview of a working app
2. **Iterate** — continue the conversation to refine the generated app
3. **Showcase** — browse a public gallery of generated apps
4. **Deploy** — push a generated app to Railway/Vercel/Netlify
5. **Insights** — (internal) RLHF metrics on generation quality

---

## 2. Tech Stack & Deploy

- **Framework:** Next.js (App Router), React, TypeScript, Tailwind
- **Runtime host:** Railway (auto-deploy on merge to `main`; health at `/api/health` exposes running git SHA + uptime)
- **Auth:** NextAuth (JWT), with a guest tier for anonymous demo generations
- **Live preview renderer:** **Sandpack** (`@babel/standalone`, in-browser) — generated React renders in a Sandpack iframe. There is also a legacy `/preview/[id]` SSR/iframe fallback.
- **AI providers:** Claude (Anthropic SDK, direct) when `ANTHROPIC_API_KEY` (`sk-ant-`) is set → default model `claude-sonnet-4`. Otherwise AINative-proxied open models (kimi-k2.6 paid; ministral-14b / nous-coder / gpt-oss-20b free) via an OpenAI-compatible client.
- **Data layer:** **ZeroDB** (AINative) via REST — project `5dfbc60c-…`, tables incl. `generations`, `rlhf_training_data`, `rlhf_feedback`.
- **Images:** Unsplash service for contextual imagery in generated apps.
- **Rate limiting:** per-IP on generation endpoints (generation endpoints exempt from some read limits).

---

## 3. The Backend — Generation Pipeline (the heart of the product)

This is the most important part for design to understand, because **the entire UX is a real-time window into this pipeline.** A new UI must surface this streaming lifecycle.

### 3.1 Primary endpoint: `POST /api/chat-ws`
The real generation endpoint the frontend uses (SSE stream — despite the "-ws" name it's Server-Sent Events, not a socket). Request: `{ message, chatId?, model? }`.

**It streams a sequence of typed events** the UI renders live:

| SSE `type` | Meaning | Current UI treatment |
|---|---|---|
| `init` | chatId + preview URL assigned | preview panel opens |
| `build_step` | human-readable progress ("Analyzing requirements…", "Building Card Component…", "Generating with Claude…", "Loading preview environment…") | shown as a checklist of build steps |
| `refresh` | partial code ready — re-render preview | iframe refreshes |
| `chunk` | assistant chat text (Cody's message) | appended to chat transcript |
| `files` | the parsed multi-file app `{path: code}` | handed to Sandpack to render |
| `validation_error` | generated code failed validation | shows a "Code Validation Error → regenerate" panel |
| `complete` | done — `{chatId, demo, hasValidationError?}` | shows "Files N/N completed" + 👍/👎 rating |

**Design opportunity:** the streamed `build_step` narration is Cody "thinking out loud." Today it's a plain checklist. This is the richest surface for a more expressive, agentic UX (live agent reasoning, tool calls, subagent handoffs).

### 3.2 Pipeline stages (server-side, inside `/api/chat-ws`)
1. **Prompt enhancement** — `verifyAndEnhancePrompt`, mock-data injection, theme selection (`selectTheme`), contextual Unsplash images, ZeroMemory recall of prior components.
2. **Complexity routing** — `analyzeComplexity` decides single-pass vs. **multi-pass agent** build. Complex prompts route to the **headless Claude Code agent** (worktree-isolated, build-and-verify).
3. **Generation** — Claude-direct or AINative model, streamed. Multi-file output uses `// --- FILE: path ---` markers.
4. **Validation & auto-repair** — `validateGeneratedCode` (Babel parse + a large library of auto-fixes: duplicate-import de-dupe, malformed-ternary repair, stray-semicolon fixes, import injection). On failure → **retry** with error fed back, then **agent fallback**.
5. **Multi-file parse + import injection** — `parseMultiFileOutput` splits files and injects missing imports (recharts, lucide-react, AIKit). Each rendered file is re-sanitized for Sandpack.
6. **Persist + learn** — save to ZeroDB (`generations`), log full lifecycle to `rlhf_training_data`, feed outcome to the **intelligence loop** (ZeroMemory), auto-add quality builds to the showcase, background SSR build.

> **Known reliability note for design:** generation is currently **intermittently unreliable** (~a quarter of fresh prompts hit a validation error and show the "regenerate" panel instead of the app). Engineering is hardening the retry/regeneration loop. A new UX should treat "generation failed, retrying" as a **first-class, gracefully-designed state**, not an edge case — e.g. Cody transparently retrying, showing progress, never a dead end.

### 3.3 Preview / render
- `files` event → Sandpack iframe renders the live React app.
- `POST/GET /api/preview` + `/api/preview/[id]` — store/fetch preview payloads (in-memory + Redis-backed store; SSR fallback).
- `/api/preview/simple/[id]` — lightweight variant.

---

## 4. Full API Surface

Grouped by capability. All under `/api`. Auth: most require a NextAuth session; public ones noted. (Methods in parens.)

### Generation & Chat
- `chat-ws` (POST) — **primary generation stream** (SSE). *public (guest-allowed)*
- `chat` (POST) — legacy single-pass generation. *(currently degraded — frontend uses chat-ws)*
- `chat-llama` (POST) — direct Llama path
- `chats` (GET), `chats/[chatId]` (GET), `chats/[chatId]/code` (GET) — chat history + generated code
- `chats-v2` (GET), `chats-v2/[chatId]` (GET, DELETE) — newer chat store
- `chat/ownership` (POST), `chat/fork`, `chat/delete`

### Preview & Showcase
- `preview` (POST, GET), `preview/[id]`, `preview/simple/[id]` — live preview payloads. *public*
- `showcase` (GET, POST) — public gallery of generated apps (GET public); POST auto-adds a quality build
- `showcase/preview` — showcase render

### Deploy
- `deploy` (POST) — deploy a generated app
- `deployments` (GET), `deployments/[id]` (GET, DELETE)
- `webhooks/{railway,vercel,netlify,ainative}` — deploy status callbacks
- `credentials` (GET, POST), `credentials/[id]` (DELETE), `credentials/[id]/test` (POST) — deploy provider creds

### ZeroDB (data layer for generated apps + platform)
- `db/[table]` (GET, POST, …) — **proxy so generated apps get live CRUD** against ZeroDB. *public*
- `zerodb/[...path]` (GET, POST, PUT, DELETE) — full ZeroDB passthrough
- `zerodb/schema/[tableName]` (GET) — table schema

### Agent & Intelligence
- `agent/metrics` (GET), `agent/export` (GET) — agent build-pass rates, run export
- `context/{track,optimize,unload,preload-cost,budget}` — context-budget manager
- `evidence`, `evidence/[id]`, `evidence/[id]/artifacts` — evidence collection system
- `rules`, `rules/{validate,auto-fix,stats,violations}`, `rules/[ruleId]` — rule enforcement framework

### RLHF / Training (BW-1 pipeline)
- `rlhf/submit-feedback` (POST) — 👍/👎 + edit signal → `rlhf_feedback`
- `rlhf/insights` (GET) — quality metrics (avg rating, first-pass success, latency percentiles)
- `rlhf/export` (GET) — JSONL export of full prompt→completion training data

### Design System (AIKit / tokens)
- `design-tokens` (GET), `design-tokens/upload` (POST), `design-tokens/[tokenId]` (GET, PATCH, DELETE), `…/activate` (PUT), `…/revert` (POST), `…/versions` (GET) — design-token management + versioning
- `a2ui`, `a2ui/action`, `a2ui/poll` — Agent-to-UI protocol surface

### Content & Reuse
- `templates` (GET), `templates/[id]`, `templates/submit`, `templates/analytics` — template library
- `prompts` (GET, POST), `prompts/[id]`, `…/activate` — prompt versions (A/B)
- `few-shot-examples` (GET, POST), `few-shot-examples/[id]`
- `skills` (GET, POST), `skills/search`, `skills/recommend`, `skills/[skillId]` (+ `/rating`, `/usage`)
- `commands` (GET, POST), `commands/recent`, `commands/[commandId]` (+ `/execute`, `/favorite`) — command palette for agent workflows
- `component-registry` (via service)

### Platform
- `auth/{login,register,logout,guest,[...nextauth]}`
- `credits` (GET), `credits/estimate` — usage credits
- `usage` (GET), `agent/metrics` — usage/metrics
- `health` (GET) — status + git SHA + uptime. *public*
- `export`, `export/[id]` — export a generated project
- `artifacts/[id]` — build artifacts
- `cron/alerts` — scheduled alerts
- `admin/errors`, `admin/template-submissions` — admin

---

## 5. AINative Primitive Integration (the differentiator)

The product is a **reference implementation of the AINative stack**. A new UX should make these primitives *visible and legible* — they're the story.

- **ZeroDB** — every generation persists to ZeroDB (`generations`); training data to `rlhf_training_data`/`rlhf_feedback`. Generated apps themselves get **live CRUD** via the `/api/db/[table]` proxy, so a generated app can read/write real data with zero backend setup ("zero-human provisioning"). ~23 backend touchpoints.
- **ZeroMemory** — the **intelligence loop**: every generation outcome (score, validation, agent metrics) is stored as episodic memory via `memory/v2/remember`. Prior components are recalled to inform new builds. This is the "recursive intelligence" — the builder learns from every generation.
- **AIKit** — the component library generated apps import from (`MetricCard`, `AgentCard`, `SwarmView`, `ChatBubble`, `StreamingIndicator`, `AIKitTable`, `AIKitSidebar`, `AIKitPriceCard`, etc.). The system prompt steers the model toward AIKit primitives; the import injector wires them for Sandpack.
- **Agent runtime** — headless Claude Code agent (worktree isolation, build-and-verify) for complex multi-file builds; subagent orchestration; agent-run metrics.
- **RLHF / BW-1** — full prompt→completion→feedback lifecycle captured for training the AINative BW-1 model.
- **A2UI** — Agent-to-UI protocol endpoints for agent-driven interface actions.

---

## 6. Current UI (what exists today — free to replace)

**Frontend pages (App Router):**
- `/` (home) — hero + prompt textarea + archetype suggestion chips ("Agent Dashboard", "AI Chat Interface", "SaaS Platform"…). This is the primary entry.
- `/chats`, `/chats/[chatId]` — generation workspace (chat transcript left, live preview right)
- `/showcase`, `/showcase/[slug]` — public gallery
- `/preview/[id]` — standalone preview
- `/templates`, `/templates/[slug]`, `/templates/submit`, `/templates/analytics`
- `/deployments`, `/settings/credentials`
- `/insights` — RLHF metrics dashboard
- `/design-tokens`, `/docs/components`, `/storybook` — design system
- `/compare/[competitor]` — SEO comparison pages
- `(auth)/login`, `(auth)/register`

**Current generation workspace layout (the core screen):**
- **Left panel:** chat transcript — user prompt, Cody's assistant messages, a "Files N/N completed" progress card, 👍/👎 rating, and a "Continue the conversation…" input.
- **Right panel:** the preview display area — a toolbar (refresh, view-code, deploy, export, fullscreen, a `/preview/<id>` URL bar) above the **Sandpack live render** of the generated app.
- **Build steps** stream in during generation as a checklist.

**Known UX pain points (design targets):**
1. The **failure state is a dead end** — "Code Validation Error → try regenerating" with no automatic recovery. Should become a transparent, Cody-led retry.
2. Build-step narration is a flat checklist — under-uses the agentic, "watch Cody build" potential.
3. The preview/chat split is conventional (v0-clone); there's room for a genuinely different spatial/interaction model.
4. AINative primitives (ZeroDB live data, ZeroMemory learning, AIKit components) are **invisible** to the user — the differentiators aren't surfaced.

---

## 7. Design Brief (what we want from Claude Design)

Reinvent the **UI/UX flow** end-to-end for AINative Builder, keeping:
- **Cody** as the lead agent persona and narrative voice
- the backend/API surface and the `/api/chat-ws` streaming lifecycle (Section 3) as the fixed foundation
- the live in-browser preview as the payoff moment

Explicitly in scope to rethink: the entry experience, the "watch it build" moment, the failure/retry experience, how iteration works, and **how to make the AINative primitives (ZeroDB, ZeroMemory, AIKit, agents) visible as the product's superpower** rather than hidden plumbing.

**Key data contracts to design around:**
- Generation is a **stream of typed events** (`build_step` → `files` → `complete` / `validation_error`), not a single request/response. The UI is a live view of an agent working.
- Generation is **probabilistic and sometimes fails** — retry must be a designed, graceful, first-class state.
- Every output is **persisted and learned from** — there's a real "gets smarter over time" story to tell.

---

*Appendix: exact request/response shapes for each endpoint can be pulled from `app/api/**/route.ts`. The generation event schema is authoritative in `app/api/chat-ws/route.ts`.*
