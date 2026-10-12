# Runbook: stuck-paid-founder plan backfill (#1032)

Companion to [#1032](https://github.com/AINative-Studio/builder-ainative-studio/issues/1032).
`amador@selfpreneur.com` (company `agentive`) was a genuine, confirmed `pro`
subscriber in core but his Builder registry row had `plan: null` — fixed by
hand on 2026-10-08 via `setAppPlan('agentive', 'pro')`. This runbook covers
the sweep that answers the issue's real question: **how many OTHER
companies are in the same state?**

## What it checks

For every company in `builder_app_registry` whose registry `plan` is not
already a paid tier, the sweep cross-references `ownerEmail` against core's
real admin lookup (`GET /api/v1/admin/users?email=…`, via
`fetchPlanByEmail` in `lib/ainative/admin-plan-lookup.ts`) and classifies it:

| Disposition | Meaning |
| --- | --- |
| `mismatch` | Core confirms a genuinely paid plan, registry disagrees — the real bug. |
| `already_paid_in_registry` | Registry already reflects a paid tier — nothing to do. |
| `confirmed_unpaid` | Core confirms the account really is unpaid (Greg Rose's case — must NOT be "fixed"). |
| `no_owner_email` | Anonymous company — nothing to cross-reference. |
| `unverifiable` | Core lookup failed/ambiguous — skipped, never guessed at (fail closed). |

Only a confirmed `mismatch` is ever written, and only via `setAppPlan()`
(`lib/build/app-registry.ts`) — the same safe, already-used write path used
for Amador's manual fix. Nothing else is touched.

**Out of scope, intentionally:** the ZeroDB key-claim half (`tmp_` →
permanent). Per the issue and CODY.md Rule 5, `claimCompanyProject` /
core's `/instant-db/claim` authenticates against whoever's token calls it —
there is no service-level workaround, and this sweep does not attempt one. A
founder whose plan the sweep corrects still needs to log back in once for
`reconcilePlanFulfillment` to finish the key migration.

## Running it

```bash
# Dry run (default, report-only — no writes)
railway run --service builder-ainative-studio npx tsx scripts/backfill-stuck-paid-founders.ts

# Real run — writes via setAppPlan() for confirmed mismatches only
railway run --service builder-ainative-studio npx tsx scripts/backfill-stuck-paid-founders.ts --execute
```

## Real dry-run result (2026-10-12, production)

```
companies checked : 178
mismatches found  : 40
fixed (setAppPlan): 0   (dry run — no writes)
failed            : 0
by disposition    : {"already_paid_in_registry":7,"no_owner_email":113,
                      "confirmed_unpaid":13,"mismatch":40,"unverifiable":5}
```

`agentive` (Amador's already-manually-fixed company) correctly shows up as
`already_paid_in_registry`, confirming the sweep does not re-flag a company
already repaired.

Of the 40 mismatches:
- **`shiphive`** — a second company owned by `amador@selfpreneur.com`
  (core plan `pro`), the direct sibling of the `agentive` case the issue was
  filed for.
- The remaining 39 are owned by `admin@ainative.studio`,
  `admin@winning.careers`, and `nf@winning.careers` — internal/staff
  accounts core reports as `enterprise` — not independent founder reports of
  being stuck. These are real registry/core disagreements too, but a
  different population than "a paying founder whose plan never got stamped"
  — worth a human decision on how the sweep's `--execute` should be scoped
  (all 40, or external-founder rows only) before running it for real.

No `--execute` run has been performed. That decision — and the actual write
— is left for a human to make after reviewing this list.
