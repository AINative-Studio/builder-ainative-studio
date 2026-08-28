# Autonomous work-list — carry forward across session reset (2026-08-27 ~2am)

Standing loop: work these in priority order. For EACH: fix on a branch → gate (tsc + `npx vitest run` with dev server killed; VITEST not jest) → `pnpm build` → deploy `railway up --detach` with `&&` gating → live-verify on prod → close the issue with evidence. NO AI attribution in commits. Beware `git apply` is atomic — merge worktrees per-file. Check `docs/audits/CODEBASE_AUDIT_2026-08-27.md` before building new (wire dormant first).

## P0 — do first
1. **#350** — [REAL FIX LANDED c43c826/4241b184: complexity-gated discipline + 4min wall-clock timeout; suite 2959 green. Re-enabling CODY_AGENT_PRIMARY is now safe-from-runaway but gated on measurement.] Agent generation exhausts budget/max_tokens on a 13-min turns=1 run, ships the 263-char stub. MITIGATED (CODY_AGENT_PRIMARY unset → bedrock path primary, proven to produce real 18k-char apps). REAL FIX still needed: gate the plan/review/test/MCP prompt blocks (added this session in claude-agent.ts AGENT_SYSTEM_PROMPT + test-runner + plan-review + primitive-catalog mcpDataProvisioningBlock, ~1100 tokens) on COMPLEXITY so simple/medium apps get the lean prompt; add a ~4min wall-clock timeout to runHeadlessAgent that aborts to fallback; cap per-turn max_tokens. Only then reconsider CODY_AGENT_PRIMARY=1. Root cause is my session's build-quality features overloading the agent.
2. **#348** — Unedited scaffold ('Builder Session' 263-char stub) persists as the app; gates pass valid-but-empty output. Fix: scaffold-identity gate in ready-gate (reject byte-identical/placeholder-containing App.tsx via a SCAFFOLD_FINGERPRINT), agent-produced-nothing guard (no App.tsx edit in trajectory → generation_failed), min-substance floor (<500 chars = retry), change the placeholder text to an obvious sentinel.

## Verify / cleanup
3. **aerosol** (slug) — regen on the fixed bedrock path succeeded generating real apps but the LAST register (chatId UZJvTwOq6C75Xn34NIXH9) shows 0 durable chars = persist race (registered before durable save). Re-run scratchpad/regen-aerosol2.mjs, confirm `loadGeneration` returns >2000 chars AND headless render shows real content, before trusting the pointer. Same for **tidemark** (still points at a FAIL build HtjoKXT1nzxu_U-UUIy4L which IS 21k real code but rendered fail — re-verify).
4. **Harness measurement study** — resume agent a7de5930dc293a9cf (was rate-limited by ANTHROPIC, transient) to finish the committee confusion matrix (#346) + staircase A/B (#345) and write docs/audits/HARNESS_MEASUREMENT_2026-08-27.md. Ensure CODY_CONTEXT_STAIRCASE_WIRED stays UNSET on prod after.

## Backlog (build when P0 clear)
5. **#344** — Replit-style winback email via Resend (spec: docs/growth/WINBACK_EMAIL_2026-08-27.md). Prereq: fix the /api/cron/* middleware allowlist (audit dormant finding #9) so a cron can fire.
6. **#347** — Trajectory fork/merge DAG (medium-term; after #345/#346 measured).
7. **#349** — EPIC per-company Gitea on Railway. Needs founder decisions (org tenancy, founder git access r/w vs read-only) before implementation — do NOT start building without those answers; the epic body lists them.

## Guardrails
- CODY_AGENT_PRIMARY must stay UNSET until #350's real fix lands (bedrock path is primary + reliable).
- CODY_CONTEXT_STAIRCASE_WIRED must stay UNSET (staircase inert until measured).
- If prod chat-ws returns 0 bytes: that's the 13-min agent timeout OR a transient — check Railway logs for reason=max_tokens before assuming a rate limit. It is NOT a Bedrock/AINative quota.
