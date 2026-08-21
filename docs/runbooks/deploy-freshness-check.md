# Runbook: deploy freshness / version check

Catches the failure mode from [#261](https://github.com/AINative-Studio/builder-ainative-studio/issues/261)
(part of EPIC #207): a deploy reported **SUCCESS** but prod actually served
**stale / rolled-back code** (e.g. the builder's new `trial` field was missing;
domain search 502'd). The deploy dashboard was green while users hit old code,
and nothing surfaced the gap.

---

## The signal

The Builder exposes the commit it was built from at a public, dependency-free
endpoint:

```
GET https://builder.ainative.studio/api/version
GET https://builder.ainative.studio/version          # convenience rewrite
```

Response:

```json
{
  "service": "builder",
  "commit": "3c02c13...",
  "builtAt": "2026-08-21T00:00:00Z",
  "environment": "production",
  "timestamp": "2026-08-21T12:00:00Z"
}
```

- `commit` is sourced (in order) from `RAILWAY_GIT_COMMIT_SHA`,
  `VERCEL_GIT_COMMIT_SHA`, then `NEXT_PUBLIC_BUILD_SHA`. If none is set it is
  `"unknown"` (the endpoint never crashes).
- `/api/health` also carries the same SHA in its `version` field.

> Railway injects `RAILWAY_GIT_COMMIT_SHA` automatically. If deploying somewhere
> that does not, bake `NEXT_PUBLIC_BUILD_SHA` at build time
> (e.g. `NEXT_PUBLIC_BUILD_SHA=$(git rev-parse HEAD)`).

---

## Assert after every deploy

Confirm prod serves the commit you just shipped. Run this once the deploy
reports success:

```bash
URL=https://builder.ainative.studio
EXPECTED=$(git rev-parse HEAD)          # the commit you deployed

SERVED=$(curl -fsS "$URL/api/version" | jq -r .commit)

if [ "$SERVED" = "$EXPECTED" ]; then
  echo "OK: prod serves $SERVED"
else
  echo "STALE DEPLOY: expected $EXPECTED, prod serves $SERVED" >&2
  exit 1
fi
```

If it fails, the deploy is stale or was rolled back — re-trigger the deploy (or
reconnect the Railway service) and re-run the assertion. Do **not** trust the
green "SUCCESS" badge alone.

> CI is currently billing-blocked (see `github-actions-billing.md`), so this is
> a manual/monitor check, not a pipeline gate. A synthetic monitor can poll
> `/api/version` and alert when `commit` stops matching the latest `main` SHA.
