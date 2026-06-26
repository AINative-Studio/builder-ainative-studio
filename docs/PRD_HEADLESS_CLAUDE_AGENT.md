# PRD — Headless Claude Code Agent for the Builder

> **Status:** Draft for implementation
> **Owner:** TBD (assign to builder agents)
> **Created:** 2026-06-25
> **Related:** `docs/SUBAGENT_ARCHITECTURE.md`, `docs/chunking-architecture.md`

---

## 1. Problem

The builder generates UI/code today by calling an OpenAI-compatible chat-completions API (AINative managed completions) in a **single-turn, no-tools** loop, with manual chunking and a one-shot regex validate-and-retry. See `app/api/chat-ws/route.ts`.

This is **AI-layered**, not **AI-native**: the model *writes* code but never *operates* on a project. It cannot:
- Read the existing project files it's editing
- Run the build and see real compiler/type errors
- Iterate until the code actually compiles and renders
- Run tests or take a screenshot to verify the result

The existing 4-tier "subagent" system (`docs/SUBAGENT_ARCHITECTURE.md`, `lib/agent/subagents.ts`) **simulates** orchestrator→design→code→validation via separate completion calls — the agents have no tools and no filesystem, so the orchestration is cosmetic.

**Result:** validation failures, truncated output (the `llama-4-maverick` 512-token cap workaround in `route.ts:51-83`), and previews that look right but don't compile.

## 2. Goal

Replace the simulated codegen loop with a **real headless Claude Code agent** (via `@anthropic-ai/claude-agent-sdk`) that operates on a **per-session git worktree** with actual tools, streaming its progress through the **existing SSE envelope** so the frontend is largely unchanged.

Turn "AI generates code" into "**AI builds, verifies, and fixes code until it works.**"

This is the flagship demonstration of AINative's Agent-Experience (AX) thesis — dogfooding our own stack.

## 3. Non-Goals

- Rewriting the frontend streaming/preview UI — we reuse the SSE event envelope.
- Replacing auth, session model, or storage (PostgreSQL/ZeroDB/preview-store stay).
- Building a new sandbox — we reuse the Railway sandbox executor for SSR preview.
- Changing the managed-completions path for non-agentic/simple prompts (keep as a fast path).

## 4. Current Architecture (grounded)

| Concern | Today | File |
|---------|-------|------|
| Codegen | OpenAI-compat `chat.completions.create`, single-turn, no tools | `app/api/chat-ws/route.ts:281-445` |
| Orchestration | Manual PRD parse → complexity score → chunk plan → sequential calls | `lib/agent/chunk-planner.ts`, `multi-pass-generator.ts` |
| "Subagents" | Simulated via separate completions (no tools) | `lib/agent/subagents.ts` |
| Validation | Regex/`@babel/parser` syntax check + 1 auto-retry | `lib/code-validator.ts`, `route.ts:465-541` |
| Streaming | SSE, newline-delimited JSON events | `route.ts:107-805`, `hooks/use-chat.ts`, `components/chat/chat-messages.tsx` |
| Storage | in-memory Map (24h) → PostgreSQL `generations` → ZeroDB | `lib/preview-store.ts`, `lib/zerodb-store.ts`, `lib/db/schema.ts:115-148` |
| Preview | SSR HTML via Railway sandbox + Sandpack iframe | `app/api/preview/[id]/route.ts`, `lib/sandbox-builder.ts` |
| Auth/session | NextAuth 5 + AINative token; chat_id (nanoid) → user_id | `app/(auth)/auth.ts`, `middleware.ts`, schema `chat_ownerships` |
| Deps | `openai@5`, `@anthropic-ai/sdk@0.65` (subagents only), Sandpack, Drizzle | `package.json` |

Key fact: `@anthropic-ai/sdk` is already a dependency, and the SSE event types (`build_step`, `chunk_progress`, `files`, `chunk`, `complete`, `error`) map almost 1:1 to agent progress — so the integration surface is small.

## 5. Proposed Architecture

### 5.1 Per-session git worktree (isolation)

Each build session gets its own git worktree so concurrent users never collide (this mirrors the isolation lesson from core: multiple agents must not share one working tree).

```
/var/builder-sessions/<chatId>/        # git worktree, branch session/<chatId>
  ├─ (scaffold: vite/next starter or the user's existing project)
  └─ agent reads/writes here
```

- Worktree created from a cached template repo (fast: `git worktree add`, not full clone).
- Auto-removed after the session completes or a TTL (e.g. 1h) expires.
- Disk-bounded: cap concurrent worktrees; queue beyond the cap.

### 5.2 The agent loop (replaces single-pass codegen)

`POST /api/chat-ws` → after PRD parse → spawn a headless Claude Code agent via `@anthropic-ai/claude-agent-sdk`:

```ts
import { query } from '@anthropic-ai/claude-agent-sdk'

for await (const ev of query({
  prompt: buildAgentPrompt(prd, themeTokens, conversation),
  options: {
    cwd: worktreePath,                 // the per-session worktree
    model: tier === 'paid' ? 'claude-sonnet-4-5' : undefined,
    allowedTools: ['Read','Write','Edit','Bash','Glob','Grep'],
    permissionMode: 'acceptEdits',     // sandboxed worktree → safe
    maxTurns: tier === 'paid' ? 12 : 5,
  },
})) {
  // translate agent events → existing SSE envelope (5.3)
}
```

The agent autonomously: reads the scaffold, writes/edits files, runs `npm run build` / `tsc` / tests via Bash, sees errors, fixes them, iterates — then signals done.

### 5.3 Event translation (frontend unchanged)

Map Agent SDK stream events onto the existing SSE JSON envelope so `chat-messages.tsx` needs no rewrite:

| Agent SDK event | Existing SSE event |
|-----------------|--------------------|
| tool_use: Edit/Write `<file>` | `{type:'build_step', step:'Editing <file>'}` |
| tool_use: Bash `npm run build` | `{type:'build_step', step:'Running build…'}` |
| assistant text | `{type:'chunk', content:'…'}` |
| turn N of M | `{type:'chunk_progress', phase:N, totalPhases:M}` |
| final files written | `{type:'files', files:{…}}` (read from worktree) |
| done | `{type:'complete', chatId, demo}` |
| error/maxTurns | `{type:'error', error:'…'}` |

Keepalive every 15s is retained (agent runs can exceed 60s).

### 5.4 Result capture (reuse storage + preview)

On completion: read the worktree's output files → write to `generations` (PostgreSQL) + ZeroDB + preview-store exactly as today → fire SSR build via the Railway sandbox → return the `/preview/<chatId>` URL. **No preview/storage changes.**

### 5.5 Fast path preserved

Simple prompts (complexity below threshold) keep using the existing single-pass managed-completions path for latency/cost. The agent is engaged for complex/multi-file builds or when the fast path's validation fails — making the agent a **smart fallback first, default later**.

## 6. Model & cost — VERIFIED CONSTRAINT (2026-06-25)

Open Question #1 has been answered against the authoritative `@anthropic-ai/claude-agent-sdk` docs:

- The Agent SDK speaks the **Anthropic protocol** and supports exactly these backends: `ANTHROPIC_API_KEY`, **Amazon Bedrock** (`CLAUDE_CODE_USE_BEDROCK=1`), **Google Vertex** (`CLAUDE_CODE_USE_VERTEX=1`), **Microsoft Foundry** (`CLAUDE_CODE_USE_FOUNDRY=1`). OAuth/subscription login is disallowed for third-party developers.
- `ANTHROPIC_BASE_URL` **can** redirect sampling requests to a proxy you control — but the endpoint behind it must speak the **Anthropic Messages API and serve a Claude model.** It does **NOT** let the agent run on Llama/Qwen/NIM/OpenAI-compatible models.

**Implication:** the agent loop necessarily runs on **Claude** (the SDK's whole value is Claude's tool-use/agentic loop). It cannot be backed by the cheap open-source providers the simple completions path uses. So:

- **Path A (recommended):** `ANTHROPIC_BASE_URL` → a thin AINative proxy that forwards to a **funded Claude backend** (direct Anthropic with a funded org key, or Bedrock/Vertex Claude credits). The proxy is where we enforce per-user metering/credits and keep the key server-side. This is real Claude billing — price the agentic build tier accordingly (it is a premium feature, not the free path).
- **Path B:** point the SDK straight at **Bedrock/Vertex** if those Claude credits are cheaper/available.
- **Do NOT** try to back the agent with NIM/DO open-source models — incompatible protocol. Those remain the engine for the **fast (non-agent) path** only.

**Cost control:** gate the agent behind the **paid tier only** initially; `maxTurns` cap per tier; worktree TTL; concurrent-session cap; per-session token budget surfaced in the existing `usage` field; the proxy enforces a hard per-session credit ceiling before the agent can spend.

This makes the agent a **premium, opt-in "build & verify" mode**, with the existing fast completions path (cheap open-source models) as the default. That split is the right product shape anyway.

## 7. Schema changes (additive)

Add to `lib/db/schema.ts` (Drizzle migration):
- `agent_runs`: `id, chat_id, user_id, model, turns, tools_used (jsonb), build_passed (bool), duration_ms, token_usage (jsonb), created_at`
- Optional `generations.agent_run_id` FK for audit trail.

## 8. Rollout plan

1. **Phase 0 — spike:** headless agent in a worktree generating one component, build-verified, behind `USE_CLAUDE_AGENT=true`. Validate the Agent SDK can target the AINative base URL.
2. **Phase 1 — event bridge:** wire agent events → existing SSE envelope; frontend renders unchanged.
3. **Phase 2 — smart fallback:** engage the agent when the fast path validation fails; A/B vs current via the existing `prompt_versions`/`rlhf_feedback` tables.
4. **Phase 3 — build verification:** agent runs `npm run build`/`tsc` in-worktree; only return previews that compile. Track `build_passed` in `agent_runs`.
5. **Phase 4 — default for complex:** make the agent the default path for multi-file/complex prompts; keep fast path for simple ones.

## 9. Success metrics

- **Build-pass rate**: % of agent generations that compile (`agent_runs.build_passed`) — target >90% vs current validation-failure baseline.
- **Truncation eliminated**: removes the 512-token-cap class of failures (agent writes files directly, not one giant completion).
- **RLHF 👍 rate** up vs the completion baseline (existing `rlhf_feedback`).
- **Time-to-working-preview** (not just time-to-first-token).

## 10. Open questions

- ~~Can the SDK target the AINative OpenAI-compatible endpoint?~~ **RESOLVED (§6):** no — SDK requires Anthropic-protocol + Claude. Use `ANTHROPIC_BASE_URL` → funded-Claude proxy, or Bedrock/Vertex. Agent runs on Claude only; open-source providers stay on the fast path.
- Scaffold strategy: one canonical Vite/Next starter, or detect from prompt?
- Worktree host: same Railway service as the builder, or a dedicated executor (the existing Railway sandbox could host them)?
- Concurrency cap + queueing UX when at capacity.

## 11. What this reuses vs replaces

**Reuses:** SSE envelope, `use-chat.ts`, `chat-messages.tsx`, preview-store/ZeroDB/PostgreSQL, Railway SSR sandbox, NextAuth/AINative auth, design-token injection, `prompt_versions`/`rlhf_feedback`.

**Replaces:** the single-pass `chat.completions` codegen + manual chunking + regex validate-retry in `app/api/chat-ws/route.ts:200-541`, and the *simulated* `lib/agent/subagents.ts` (becomes a real agent with tools).
