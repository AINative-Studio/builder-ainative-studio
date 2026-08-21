# Runbook: GitHub Actions billing blocked org-wide

**Owner action required — this is an ops/billing issue, not a code bug.** An
agent cannot fix a failed payment; a GitHub org owner (or billing manager) must
update the payment method. Tracking issue: [#244](https://github.com/AINative-Studio/builder-ainative-studio/issues/244)
(part of EPIC #207).

---

## Symptom

- GitHub shows the banner: **"recent account payments have failed"** on the
  **AINative-Studio** org.
- **All CI is red** across every repo (`core`, `cody-cli`, `builder`) starting
  **~2026-08-20 08:20 UTC**.
- Workflow runs fail immediately (or never start) with a billing/spending
  message rather than a test or build error.
- The **last green run was 08:20** — everything after that is the billing block,
  not a regression. There are **zero code issues** behind the failures.

## Root cause

A **metered GitHub Actions overage charge failed** against the AINative-Studio
org's payment method. GitHub bills Actions minutes/storage overages separately
from the base subscription, so when that charge bounces, GitHub **disables
Actions org-wide** until the payment method is fixed.

Key point: **this is NOT a spending-limit problem.**
- Per-repo Actions budgets ($0 / $25) do **not** help and are **not** the cause.
- Raising or lowering a per-repo budget will **not** unblock CI.
- The only fix is to make the **failed charge clear** by updating/re-entering a
  valid card on the org billing settings.

## Fix (org owner / billing manager)

1. Go to **GitHub → Organizations → AINative-Studio → Settings → Billing**:
   <https://github.com/organizations/AINative-Studio/settings/billing>
2. Open **Payment information**.
3. **Update or re-enter the card** (a fresh, valid card is safest — re-entering
   the same card often re-triggers the retry). Save.
4. Confirm the **"recent account payments have failed"** banner clears. GitHub
   will retry the failed metered charge; the banner disappears once it settles.

## Post-fix verification

1. Re-run the failed checks (they pass — the failures are purely the billing
   block):
   - In each repo's **Actions** tab, open a failed run and click **Re-run all
     jobs** (or **Re-run failed jobs**).
   - Or via CLI, for the most recent failed run in a repo:
     ```bash
     gh run list --repo AINative-Studio/core --limit 5
     gh run rerun <run-id> --repo AINative-Studio/core
     ```
     Repeat for `AINative-Studio/cody-cli` and `AINative-Studio/builder`.
2. Confirm the re-run goes **green**. Because the last green run was 08:20 and
   nothing in the code changed, a passing re-run confirms the block is cleared.

## Prevention

Set an **org-wide Actions spending limit** so a small overage is absorbed
automatically instead of bouncing a charge and hard-blocking every repo:

1. **Settings → Billing → Spending limits** (org level):
   <https://github.com/organizations/AINative-Studio/settings/billing>
2. Set the **Actions** spending limit to **$50–$100 / month** (org-wide).
3. Do **not** rely on per-repo $0 / $25 budgets — those are the setup that let a
   metered overage fail a charge and take down all CI.

An org-wide limit in this range covers normal overage, keeps CI running, and
still caps runaway spend.

---

## Quick reference

| | |
|---|---|
| **Scope** | Org-wide (all repos: core, cody-cli, builder) |
| **Blocked since** | ~2026-08-20 08:20 UTC |
| **Root cause** | Failed metered Actions **overage charge** on org payment method |
| **NOT the cause** | Per-repo Actions spending budgets ($0 / $25) |
| **Fix** | Org Billing → Payment information → update/re-enter card |
| **Post-fix** | Re-run failed checks → they pass |
| **Prevention** | Org-wide Actions spending limit $50–$100/mo |
| **Who can fix** | GitHub org owner / billing manager (not an automated agent) |
