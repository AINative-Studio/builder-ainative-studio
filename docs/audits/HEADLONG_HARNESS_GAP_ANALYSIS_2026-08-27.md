# Headlong → Cody Harness Gap Analysis — 2026-08-27

**Source analyzed:** [AINative-Studio/headlong](https://github.com/AINative-Studio/headlong) (Laude Institute, Apache-2.0, actively maintained). Cloned and read line-by-line: `bin/recap` (817 lines), `tools/pr-committee` (414 lines), `bin/traj` (2185 lines), plus `design/tiered_memory.md`, `design/trajectory_spec.md`, `design/context_assembly.md`.

**Compared against:** our Cody builder harness — `lib/agent/{claude-agent,verify-loop,test-runner,plan-review,trajectory-capture,complexity-analyzer,subagents}.ts` and `lib/build/{ready-gate,completeness-gate,obedience-gate}.ts`.

**Method note:** every gap below is grep-verified in our codebase, not assumed.

---

## What Headlong is (in one paragraph)

A ~10K-line Bash agent microharness whose defining architecture is *persistent agency*: a self-guided "inner monologue" loop (`shellm`, a recursive-LM-in-Bash) that keeps thinking between human interactions, with Bash as the only tool. The headline feature (always-on persona) is **architecturally opposite** to our stateless, per-chat, request/response React-codegen builder and is NOT worth adopting. The engineering value is in the *surrounding tooling*: tiered logarithmic context compaction, a multi-model PR-review committee, and an append-only trajectory DAG with fork/merge.

---

## The three gaps (grep-verified) and what to port

### 1. Context compaction — WE HAVE NONE → **Issue #345**
- **Headlong:** `bin/recap --context` builds a logarithmic pyramid of immutable sealed summary blocks keyed by step-index range. Tier k holds one rollup per Fᵏ steps (F=fanout=10); a single bounded context prints coarse→fine rollups covering `[0, cut0)` then the raw tail verbatim. Correctness mechanics worth stealing exactly:
  1. **Frontier-only sealing** — only newly-complete blocks call the LLM; everything else is cached forever (incremental + idempotent).
  2. **Enable-marker snapped DOWN to a FANOUT boundary** — an unsnapped marker leaves a straddling block unbuildable forever, a permanent coverage hole at the enable point.
  3. **Positional base-F decomposition** of the older region → gapless coverage, each tier contributes ≤ F-1 blocks.
  4. **Budget = min(0.6·window, cap)**, ~40% to the raw tail (recency); capped absolutely so huge-context models don't balloon the "life" section.
  5. **Straddling coarse blocks descend into built children** rather than dropping summarized history when `cut0` crosses a FANOUT^k boundary.
- **Our reality (grep):** `lib/agent/*` has ZERO windowing/summarization/rollup. The agent runs on cody-cli's linear `--max-turns` window. Long/multi-feature builds hit the turn/context wall and degrade — the **pulsar/Greg "shallow build" symptom**. Our just-shipped plan-review + TDD turns ADD turns, worsening window pressure.
- **Value:** directly attacks build DEPTH (the day's core unsolved problem) and makes an autonomous/nightly loop viable without unbounded context growth.

### 2. Multi-model review — WE HAVE SINGLE-MODEL SELF-REVIEW → **Issue #346**
- **Headlong:** `tools/pr-committee` runs N frontier models INDEPENDENTLY over the same brief (full changed-file contents + diff + commit intent) in parallel — *independence is the confidence signal* — optional debate round, then a CHAIR model merges: dedupes, **counts cross-model agreement**, checks every finding against the diff, and **discards misreads WITH REASONS** (never silently). Has a `--diff RANGE` local mode (no PR needed). Structured reviewer output (verdict + JSON findings: file/line/severity/confidence/category). Disables the streaming stall-guard because a frontier model on a ~100k brief thinks >60s.
- **Our reality (grep):** the shipped `plan-review.ts` is ONE Sonnet reviewing its OWN output. ZERO multi-model review exists anywhere — grep found only *marketing copy* claiming we ARE multi-model (`lib/data/seo-guides.ts`). We sell multi-model but don't use it to verify builds.
- **Value:** the strongest available signal that a build is actually *good*, not just parseable. Turns a capability we already market into a real quality mechanism. **Ship offline-first** to measure ROI before spending K frontier calls per build.

### 3. Trajectory DAG — WE HAVE A FLAT ARRAY → **Issue #347 (medium-term)**
- **Headlong:** `bin/traj` is an append-only DAG — subagents FORK, results MERGE back with `parent_traj`/`parent_step` provenance; self-improvement = fork/test/merge (no rollback); `tools/shellm-explore --report` has an LLM narrate what each sub-run did.
- **Our reality (grep):** `trajectory-capture.ts` is a flat `steps[]` array, fire-and-forget — no fork/merge/parent refs. A failed validation phase dead-ends instead of re-forking; captured trajectories aren't explainable.
- **Value:** real provenance for the subagent orchestrator + richer/curatable RLHF data. Do AFTER #345 + #346 land.

---

## What NOT to take (and why)

- **The whole harness / persistent-agency model** — Bash-native, single-shared-mind, always-on persona. Adopting `shellm`/`thinkers`/persona/Slack-Telegram bridges = a rewrite with no payoff for a stateless codegen builder.
- **Bash-as-only-tool RLM core** — we rely on typed TS gates (completeness-gate, obedience-gate), MCP wiring, worktree scaffold — richer and safer than "the model writes shell."
- **The Docker broker / sandbox facade** — we already have per-session worktrees + the Railway sandbox executor.
- **The `monolith_backoff` idle-loop pattern** — only relevant IF we revive the autonomous Option-B loop; not now.

---

## Verdict

**Real value, selective port — not toy code.** Clean, actively maintained (commits within days), and two of the three ideas are gaps we'd already logged. Port the **concepts to TypeScript** (never the Bash). Priority order:

1. **#345 tiered-recap compaction** — highest ROI, attacks build depth.
2. **#346 multi-model committee** (offline-first) — measure before gating.
3. **#347 trajectory DAG** — medium-term, after the two above prove out.

Cycle for #345 + #346 launched 2026-08-27 (workflow `wf_a1a9aea1-9d9`), each bounded + fail-open with a kill switch so a harness experiment can never break a real build.

**Clone location (if deeper inspection needed):** `scratchpad/headlong` (session-local). Key files: `bin/recap`, `bin/traj`, `bin/context`, `tools/pr-committee`, `tools/shellm-explore`, `design/tiered_memory.md`, `design/trajectory_spec.md`.
