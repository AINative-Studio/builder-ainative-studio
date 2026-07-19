# Cody-CLI Integration & Generation Reliability — Engineering Recommendation

**Date:** 2026-07-18
**Author:** Engineering
**Context:** The builder's generation is unreliable (~1 in 4 fresh prompts render a broken/errored preview instead of a working app). This doc combines (a) research on modern agent-harness architectures and (b) an audit of `~/Desktop/cody-cli` to recommend how to fix it.

---

## TL;DR

1. **Root cause is architectural.** The builder does single-pass generation + regex "fixes". Every robust coding agent (Cursor, Aider, OpenHands, Bolt) instead runs a **closed loop**: generate → *actually run the code* → read the real compiler/runtime error → feed it back → retry (capped 3–5x). Regex patches symptoms; the loop fixes causes. This is 80% of the reliability gap.

2. **`@ainative/cody-cli` is that closed-loop harness, and AINative already owns it.** It has the full agentic loop (`QueryEngine`), the right tools (`FileEdit`, `FileWrite`, `Bash`, **`LSPTool`** — which catches exactly the `Element type is invalid` / undefined-import errors our regex can't), worktree isolation, a headless `stream-json` mode, and it defaults to `api.ainative.studio` for inference.

3. **Integration is nearly free.** The builder *already* spawns a headless agent — it shells out to the **external Anthropic `claude` binary** (`lib/agent/claude-agent.ts`, `spawn('claude', ['--output-format','stream-json',...])`). cody-cli speaks the same `stream-json` protocol and worktree model. **Swap the spawn target `claude` → `cody`** and we drop the external-Anthropic dependency, use AINative models, and gain the LSP-driven fix loop.

---

## Part 1 — What the research says (agent-harness best practices)

| Technique | Why it matters | Evidence |
|---|---|---|
| **Close the loop on ground truth** | Single-pass = model *guessing* it works. Loop = code *runs*, real error feeds back. | Cursor: "error handler sends that failure back into the loop." Failing trajectories are 12–82% longer / non-adaptive. |
| **Language-server / lint feedback is highest signal** | TS/ESLint/parse errors with file+line are far better than regex. Catches undefined components, bad imports. | Cursor treats lint output as "extremely high signal." |
| **Fix by error class, one at a time** | parse → type/lint → runtime → test, re-verify between. | LLMloop: pass@10 **76%→90%** from iterative feedback loops. |
| **Cap iterations (3–5)** | Most fixes land in 1–2 iterations; more spirals. | Cursor hard-codes "DO NOT loop more than 3 times." |
| **Checkpoint last-good; never render broken** | Worst case becomes "less complete," not "white screen." | Graceful-degradation literature. |
| **Edit/diff tool over full rewrite** | Diffs stop the model emitting `// ... rest here` placeholders. | Aider: unified diffs **20%→61%** success, 3× less lazy output. |
| **Keep files < 500 LoC** | Apply/edit models break on big files. | Universal (Cursor, Aider). |

**Top 5 by impact-to-effort:** (1) close the build/run→error→retry loop; (2) checkpoint last-mounting version, never show broken; (3) replace regex fixers with real compiler-error classes; (4) diff/apply edit pattern + <500 LoC files; (5) graceful degradation ladder (backoff → model fallback → cached last-good → clean partial).

## Part 2 — cody-cli audit (`~/Desktop/cody-cli`)

`@ainative/cody-cli` — "AI-powered terminal coding assistant… persistent agent memory, MCP servers, semantic code search." Bun/TypeScript, Ink TUI, native binary (`cody-bin`).

**It is a complete agent harness:**
- **Agentic loop:** `src/QueryEngine.ts` + `src/query.ts` — real tool-use iteration with usage/cost tracking, retryable-error categorization, permission modes.
- **Tools (`src/tools/`):** `FileEditTool`, `FileWriteTool`, `FileReadTool`, `BashTool`, **`LSPTool`**, `CodebaseSearchTool`, `GlobTool`, `GrepTool`, `EnterWorktreeTool`, `AgentTool` (subagents), `MCPTool`, `TaskCreate/Get/List` — the full kit.
- **Headless / embeddable:** `src/cli/print.ts` (headless print mode), `src/entrypoints/agentSdkTypes.ts` (SDK message protocol: `SDKMessage`/`SDKStatus`/`PermissionMode`), `stream-json` output, `directConnectManager` server sessions.
- **AINative-native:** `src/services/api/bootstrap.ts` → `baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.ainative.studio'`. Models: gpt-oss-120b (Cerebras), llama-3.3-70b, qwen-coder-32b, AINative fallbacks. **No dependency on Anthropic's binary or billing.**

**Why it fits our exact problem:** our worst failure class is `Element type is invalid` (undefined/mis-imported component) — a *runtime* error our Babel-based validator structurally cannot catch. cody-cli's **`LSPTool` + `BashTool` (run the build)** catch precisely these, and its loop feeds them back to the model to self-correct.

## Part 3 — How the builder invokes an agent today

`lib/agent/claude-agent.ts`:
- Gated behind `USE_CLAUDE_AGENT` / `USE_CLAUDE_AGENT_FALLBACK`.
- `runHeadlessAgent()` → `spawn('claude', ['--output-format','stream-json','--verbose', ...])` in a per-session **worktree**, respecting `ANTHROPIC_BASE_URL`.
- Depends on `@anthropic-ai/claude-code` (`package.json`) — historically fragile on Railway (dependency churn in git log).
- Wired into `app/api/chat-ws/route.ts` two ways: **auto-activate** for complex prompts, and **fallback** when fast-path validation fails.

So the agent path, worktree model, and `stream-json` consumer **already exist**. We are not building new infrastructure — we are changing what binary the loop runs and making the loop authoritative.

## Part 4 — Recommended integration (phased)

**Phase 0 — Drop-in swap (low risk, high value).**
Replace `spawn('claude', …)` with `spawn('cody', …)` behind a flag (`AGENT_RUNTIME=cody|claude`). Map cody's headless `stream-json` events to the builder's existing event bridge. Keep `claude` as fallback until parity is proven. *Result: AINative-owned agent, no external-binary risk, AINative models, LSP-driven fixes.*

**Phase 1 — Make the loop authoritative for the failing class.**
Route the generation through the agent loop with a **build/mount verify step** (cody's `BashTool` runs the sandbox build; `LSPTool` surfaces type/import errors). Feed real errors back, cap at 3–5 iterations. This directly kills the `Element type is invalid` and `Unexpected token` classes that regex can't.

**Phase 2 — Checkpoint + graceful degradation.**
Persist the last **successfully-mounting** version each iteration. On iteration cap or failure, render last-good (or a clean partial state) — **never the broken preview.** Add the fallback ladder (retry-with-backoff → model fallback → cached last-good).

**Phase 3 — Edit-tool discipline.**
Prefer cody's `FileEditTool` (diff-style) over full-file rewrites; enforce <500 LoC per file in the generation prompt. Reduces truncated/lazy output at the source.

## Part 5 — Immediate reliability fixes (independent of cody-cli, do now)

These are approved and don't require the harness swap:
1. **Fix the regression test's error detection** — it currently misses React runtime errors (`Element type is invalid`), giving false "pass". Must detect ALL preview error overlays.
2. **Fix the `Element type is invalid` class** — undefined/mis-exported components. Short-term: detect used-but-undefined component identifiers in the injector/validator; long-term: Phase 1 LSP loop.
3. **Make retry actually regenerate** — today a caught validation error dead-ends at "try regenerating"; wire an automatic re-generation (error fed back, 2–3 attempts) before showing the user any error.

---

## Bottom line

cody-cli is **very useful** — it's the exact closed-loop, LSP-equipped, AINative-owned harness the research says we need, and the builder is already 80% wired to accept it (existing worktree + `stream-json` agent path). Recommend: do the **Phase-0 swap** and the **three immediate fixes** in parallel, then make the agent loop authoritative (Phase 1–2). That is the path from "~75%, 1-in-4 broken" to "reliably delivers a working app."
