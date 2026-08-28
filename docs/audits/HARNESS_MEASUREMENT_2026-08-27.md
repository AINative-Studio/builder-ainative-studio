# Harness Measurement Study — Committee (#346) + Staircase (#345)

**Run:** 2026-08-28 (autonomous loop). **Method:** ran the offline committee route (`GET /api/build/committee-review?chatId=`) over a labeled set of real builds with KNOWN render outcomes (verified headless this session). No orchestration agent needed — the committee calls models directly through the AINative proxy, so this bypassed the Anthropic rate limit that blocked the earlier attempt.

> **Sample size caveat: N=6.** This is a directional signal, not a statistically confident result. It is enough to make a keep/gate/kill call on the committee; it is not enough to tune a threshold.

## Part A — Committee correlation (#346)

Labeled set (chatId → real render outcome, verified):
| Build | Real render | Committee verdict | Findings | Reviewers reached |
|---|---|---|---|---|
| counter (JPK6…) | PASS | approve | 0 | 1/3 |
| habit-tracker (lk3…) | PASS | request-changes | 5 | 1/3 |
| tidemark (Htj…) | PASS | approve | 5 | 1/3 |
| aerosol-syntaxerr (Wn3…) | FAIL (422 syntax) | **approve** | 2 | 1/3 |
| beacon-truncated (x-eT…) | FAIL (truncated) | request-changes | 0 | 1/3 |
| aerosol-stub (t6i…) | FAIL (263-char scaffold) | request-changes | 1 | 1/3 |

### Confusion matrix (committee verdict × real render)
|  | approve | request-changes |
|---|---|---|
| **real PASS** | 2 | 1 |
| **real FAIL** | 1 | 2 |

- **Accuracy: 4/6** (approve∧PASS + request-changes∧FAIL = 2+2).
- **False-positive (approved a build that FAILED): 1/3 of fails** — and it's the worst kind: `aerosol-syntaxerr` had a real syntax error the flattened-parse GATE caught (422), yet the committee *approved* it. The committee read the code as fine; the deterministic parse gate did not. **Cross-model review did NOT beat the cheap deterministic gate on the one case that mattered.**
- **False-negative (request-changes on a build that PASSED): 1/3 of passes** — habit-tracker rendered fine but drew 5 findings + request-changes. So the committee would have blocked a working app.

### Critical confound: the roster is degraded
**Only 1 of 3 models reached** on every build — qwen-2.5-coder-32b and gemini-2.5-pro failed through the AINative proxy on every call. So this is NOT actually a multi-MODEL committee right now; it's a single-reviewer (claude-opus-4.5) pass wearing committee clothing. The entire value proposition of #346 — *independence across models as the confidence signal* — is untested because the other two reviewers never ran. The 4/6 accuracy is a SINGLE model's accuracy, not a committee's.

### Verdict on #346: **keep-inert, needs-different-integration**
1. The offline committee, as it runs today, is a single-model reviewer that (a) missed the one real syntax failure the deterministic gate caught, and (b) would false-block a working app. On this N it does not beat the gates.
2. **Root problem to fix before any gate decision:** the roster. Two of three models fail through the AINative proxy — fix model routing so the committee is actually multi-model, THEN re-measure independence/agreement. Filed as follow-up (see below).
3. Do NOT wire it into the live gate. K frontier calls/build for a signal that currently underperforms a free parse gate is not worth it.

## Part B — Staircase A/B (#345)

**Not run this cycle — and here is the honest reason:** the staircase compacts a MULTI-TURN trajectory into a bounded context for RESUMING/long builds. Our production generation is single-pass (one chat-ws request → one build); it does not accumulate the multi-turn trajectory the staircase exists to compress. On the current single-pass path the staircase has nothing to engage. Its value only appears once we have iterative/resumed builds (edit-this-app loops) or the autonomous multi-task loop — neither of which is the live path today.

### Verdict on #345: **keep-inert until iterative builds exist**
The unit tests prove the algorithm is a correct port; there is no live path that exercises it. Re-measure when the "iterate on my app" loop or the autonomous multi-task loop ships. Keeping `CODY_CONTEXT_STAIRCASE_WIRED` unset is correct.

## Recommendations
| Feature | Recommendation |
|---|---|
| #346 committee | **keep-inert + fix the roster first.** File a follow-up to fix qwen/gemini routing through the AINative proxy, then re-measure with a real 3-model committee on a larger labeled set. Do not gate builds with it until it beats the deterministic gates. |
| #345 staircase | **keep-inert until iterative/resumed builds exist.** No live path exercises it today; the algorithm is verified by unit tests. Revisit when the edit-loop ships. |

**Guardrails:** CODY_CONTEXT_STAIRCASE_WIRED confirmed unset throughout.

---

## UPDATE 2026-08-28 — roster FIXED (#351), verdict must be re-measured

The "degraded roster" confound above is resolved. #351 (commit 9addc73, deploy c01afab3) corrected the invalid model ids: `DEFAULT_ROSTER` is now `['claude-opus-4.5', 'qwen-coder-32b', 'gemini-flash']` — three vendors that all reach the proxy. Behavior-verified live: `committee-review?chatId=CWak9S7vN1bqGOxoTEqH2` returns `rosterSize:3, succeeded:3`, three independent verdicts (approve / request-changes / needs-discussion).

**So the N=6 confusion matrix above is now STALE** — it measured a single model (claude-opus-4.5) wearing committee clothing. Before any keep/gate decision on #346, the study must be **re-run with the real 3-model committee on N≥12 labeled builds**, this time measuring actual cross-vendor AGREEMENT (do 3 vendors concur? does concurrence predict render outcome better than the free deterministic gates?). Until that re-measurement, #346 stays keep-inert. The staircase (#345) verdict is unchanged (no live single-pass path exercises it).
