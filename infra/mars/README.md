# Cody backlog agent — DigitalOcean Managed Agents (M.A.R.S.)

Implements the design from [#876](https://github.com/AINative-Studio/builder-ainative-studio/issues/876):
let Cody work `builder-ainative-studio`'s own GitHub issue backlog unattended —
GitHub assigns an issue to a bot user, a DO Managed Agents (M.A.R.S.) session
spins up, clones this repo, works the issue, and opens a PR.

**Nothing here is registered against a live trigger on this repo.** The
manifest and prompt in this directory are the template a real trigger would
use — turning it on for real is a separate, deliberate step a human takes
(see "Going live" below). This is unrelated to issue #875 (Gitea /
founder-app sandboxing) — same underlying DO product, different use case,
different repo, not touched by this change.

## Files

- `cody-backlog-agent.yaml` — the session template (manifest) a real
  `builder-ainative-studio` trigger would use. Secrets are declared as empty
  slots only; no credential values are committed.
- `cody-backlog-agent.test-repo.yaml` — identical, but points at the
  throwaway `AINative-Studio/mars-cody-loop-test` repo. Used only for
  end-to-end validation; never point this at the real backlog.
- `backlog-prompt.txt` — the prompt template passed to `--prompt` /
  `triggers create --prompt`. Turns the raw GitHub webhook payload into real
  working instructions.

## What's verified live (this DO team account, 2026-09-27/28, doctl 1.175.0)

Every claim below was actually run, not inferred from `--help` text alone.

- `doctl account get` — real, authenticated DO access on this machine.
- `doctl harness-runtime validate infra/mars/cody-backlog-agent.yaml` →
  `✓ Manifest looks valid`. Same for the test-repo variant.
- `doctl harness-runtime create --spec infra/mars/cody-backlog-agent.yaml --dry-run`
  resolves the flat manifest correctly (`agent`, `repos`, `secrets`, `egress`
  all round-trip) with secret values shown as `REDACTED` and never sent
  anywhere — `--dry-run` makes zero network calls (confirmed via `--trace`:
  no request logged).
- `doctl harness-runtime triggers list-providers --trace` — real
  `GET /v2/agents/webhook-providers` call, returning GitHub as
  `hmac-sha256` over header `X-Hub-Signature-256`, with
  `"paste_hint":"Paste the secret into the GitHub webhook Secret field."`
  This is the exact mechanism this design relies on: DO issues a per-trigger
  secret, and that same secret is what you paste into the GitHub repo's
  webhook config as the shared HMAC secret.
- `doctl harness-runtime triggers list --trace` — real `GET /v2/agents/triggers`.
- A real (deliberately-doomed) `doctl harness-runtime create --spec
  infra/mars/cody-backlog-agent.test-repo.yaml --secret ANTHROPIC_API_KEY=@<fake>
  --secret GITHUB_TOKEN=@<fake> --trace` call was made to observe the real
  flow: it hit `GET /v2/account`, then `GET /v2/agents/sessions`, then
  server-side validated the Anthropic key live and rejected it correctly:
  `ANTHROPIC_API_KEY was rejected by Anthropic (HTTP 401): {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}`
  Confirms `doctl` is a thin, direct wrapper over the public REST API — no
  hidden local request assembly beyond what the manifest YAML already
  declares (answers the issue's "exact REST field mapping" open question).
- GitHub's real `issues` webhook payload shape for `action=assigned` was
  confirmed against GitHub's own webhook-events documentation and the
  canonical `octokit/webhooks` payload-example fixture
  (`assigned.payload.json`) — not guessed. Top-level keys: `action`, `issue`,
  `assignee`, `repository`, `sender`. Relevant fields: `issue.number`,
  `issue.title`, `issue.body`, `issue.html_url`, `issue.state`,
  `assignee.login`, `repository.full_name`.
- A real throwaway test repo was created:
  [`AINative-Studio/mars-cody-loop-test`](https://github.com/AINative-Studio/mars-cody-loop-test),
  seeded with a trivial issue
  ([#1](https://github.com/AINative-Studio/mars-cody-loop-test/issues/1):
  change the contents of `GREETING.txt`) for the end-to-end proof once a
  real session can run (see "Blocked" below).

## Blocked: this team's DO account is not billing-eligible for Harness Runtime yet

`doctl harness-runtime balance -o json` on this account, right now:

```json
{
  "config": {"prepay_amount": "0.00", "is_auto_prepay_enabled": false, ...},
  "status": {"balance": "0.00", "blocked": false, "eligible": false, "month_to_date_balance": "776.68"}
}
```

`eligible: false` — this team has not opted into the Harness Runtime
prepayment gate at all (not merely "out of funds"; there is a real, separate
`$776.68` month-to-date DO balance for other services, so this is not a
general billing problem). Per `doctl harness-runtime balance --help`, every
spend-triggering command (`create`, `launch`, `resume`, `fork`, `exec`,
sending a prompt) fails until a Team Owner or Biller enables prepayment and
adds funds.

**This is a billing/account decision for a human, not something this change
works around.** A real end-to-end proof — an actual GitHub webhook firing,
a real session cloning `mars-cody-loop-test`, and a real PR against issue #1
— could not be completed as part of this change for that reason. Everything
short of that (manifest correctness, prompt design, REST endpoint shapes,
egress policy, secret plumbing, a real doomed session run far enough to hit
live Anthropic-key validation) was verified live, as documented above.

There is also a pre-existing Agent Config on this team
(`ainative-mcp-isolation-test`, an `opencode` manifest created ~7h before
this work started) — evidence someone else on the team has been probing
this same DO feature; worth checking with them before enabling billing, in
case there's already a plan or a reason it wasn't turned on.

**Next step to unblock**: a Team Owner/Biller runs
`doctl harness-runtime balance` on their own login to confirm, enables
prepayment (`is_auto_prepay_enabled` / adding funds via the DO console —
this is an account setting, not a `doctl` write command found in this CLI
version), and re-runs the end-to-end proof below.

## Secrets this needs to go live for real

| Secret | Purpose | Source |
|---|---|---|
| `ANTHROPIC_API_KEY` | Required by the `claude-code` harness itself — this is the model the agent runs on inside the sandbox. Confirmed required at manifest-build time (`doctl ... --dry-run` explicitly calls it out when unset) and confirmed validated server-side before a session starts (live 401 observed above). | A dedicated Anthropic API key, ideally with its own spend limit/alerting — do not reuse a shared production key for an unattended agent that can run repeatedly off webhook events. |
| `GITHUB_TOKEN` | Push access + PR creation on `builder-ainative-studio`. Not yet confirmed which of two paths DO expects: (a) a fine-grained PAT passed as a manifest secret, or (b) `doctl harness-runtime auth github` (team-shared OAuth connection, confirmed real via `--help`: "Connect an external provider... Opens a browser to authorize... shared by your team"). **Verify which one the manifest's `repos:` clone step actually uses before going live** — this manifest declares a `GITHUB_TOKEN` secret slot as the safer, more explicit, easier-to-scope-and-revoke default, but `doctl harness-runtime auth github` should be tried first since it's the more likely intended path for git operations specifically (the secret slot may be unused/ignored by the clone step, or may be for a different purpose like calling `gh`/GitHub's API from inside agent-run shell commands rather than for git auth itself). | A fine-grained PAT scoped to `AINative-Studio/builder-ainative-studio` only, with `contents:write`, `pull_requests:write`, `issues:read` — nothing org-wide. |
| Webhook shared secret | GitHub HMAC-SHA256 signing (`X-Hub-Signature-256`). | Generated by DO itself at `triggers create` time (shown once) — paste it into the GitHub repo's webhook config "Secret" field, per DO's own `paste_hint`. Not something to generate independently. |

## Egress allowlist

Both manifests set `egress.allow_hosts` explicitly (never `unrestricted`):

```
github.com, api.github.com, codeload.github.com, objects.githubusercontent.com,
registry.npmjs.org, api.anthropic.com
```

This covers: cloning/pushing over HTTPS, the GitHub API (issue reads, PR
creation), pnpm's default registry, and the Anthropic API the harness itself
calls. It deliberately excludes Playwright's browser-binary CDN — the
backlog loop is expected to verify with `npx vitest run` + `npx tsc
--noEmit`, this repo's real test commands (see root `CLAUDE.md`), not a full
browser install. If a future issue's verification genuinely needs a real
Playwright browser run, widen this list deliberately rather than defaulting
to unrestricted.

## `--on-hitl` policy — recommendation and reasoning

The CLI only exposes one blanket policy per session/trigger
(`approve|reject|defer`, applied to "every approval request... until the run
finishes" — confirmed from `create --help`; there is no per-action-type
granularity, e.g. no way to say "auto-approve shell commands but defer a
`git push`").

Given that constraint, and that this is push+PR access to a real,
actively-worked engineering repo:

- **Real `builder-ainative-studio` trigger (once it exists): `--on-hitl
  defer`.** Every approval request pauses for a human. This mechanism has
  zero production track record on this repo. Until there's a real history of
  clean runs, a blanket auto-approve on a repo other engineers and agents are
  concurrently working in is exactly the "no review gate" blast-radius risk
  the issue itself calls out — not a call this change should make
  unilaterally. `defer` also composes with `--resume-on-topoff` cleanly:
  deferred sessions and balance-paused sessions both wait for a human either
  way.
- **Throwaway test-repo runs only: `--on-hitl approve`.** Acceptable there
  specifically because the repo is disposable, has no other
  collaborators/agents, and contains nothing of value — the whole point of
  the test repo is to observe an unattended run end-to-end.
- **Revisit after a real trial batch.** Once there's a track record of clean
  `defer`-gated runs against the real backlog (see #876's own "run a real
  trial batch" step), it may be reasonable to move specific, well-understood
  low-risk actions to auto-approve — but that should follow from observed
  session logs (what actually asks for approval, how often, how
  high-stakes), not be assumed up front.

## Going live (for a human to do later, not part of this change)

1. A Team Owner/Biller resolves the billing-eligibility blocker above.
2. `doctl harness-runtime auth github` (or provision the fine-grained PAT —
   confirm which one the clone/push step actually needs, per the table
   above) so sessions can push to `builder-ainative-studio`.
3. Decide the real assignee: presumably a dedicated "cody" bot GitHub user
   with write access to this repo, scoped narrowly.
4. Register the real trigger:
   ```
   doctl harness-runtime triggers create \
     --kind webhook \
     --name cody-backlog-agent \
     --session-mode fresh \
     --spec infra/mars/cody-backlog-agent.yaml \
     --provider github \
     --prompt "$(cat infra/mars/backlog-prompt.txt)" \
     --secret ANTHROPIC_API_KEY=@/path/to/key \
     --secret GITHUB_TOKEN=@/path/to/token
   ```
5. Paste the trigger's returned webhook secret into a new GitHub webhook on
   `builder-ainative-studio` (Settings → Webhooks → Add webhook), payload
   URL = the trigger's `WebhookURL`, content type `application/json`, secret
   = the value from step 4, events = "Issues".
6. **Before flipping HITL to `approve` for real**, complete the end-to-end
   proof this change could not finish (billing-gated): assign the seeded
   issue on `mars-cody-loop-test` (#1) to confirm a live GitHub webhook →
   session → PR loop, end to end, with `--on-hitl defer` first so a human
   watches the first real run play out before deciding anything is safe to
   auto-approve.

## Pausing / turning it off

- `doctl harness-runtime triggers update <trigger-id> --status paused` —
  stops new runs firing without deleting the trigger or its webhook secret.
- `doctl harness-runtime triggers delete <trigger-id>` — full teardown.
  Remove the corresponding webhook from the GitHub repo's settings too, or
  GitHub will keep retrying failed deliveries against a dead URL.
- `doctl harness-runtime triggers rotate-secret <trigger-id> --grace-period 0`
  — immediately invalidate the current webhook secret (e.g. if it leaked),
  then update the GitHub webhook config with the new one.

## Known gaps / things a human should double check before going live

- **`GITHUB_TOKEN` vs `doctl harness-runtime auth github`**: not resolved
  live (see table above) — pick one before registering the real trigger.
- **`{{payload.<field>}}` dotted-path templating**: not confirmed live.
  `backlog-prompt.txt` deliberately uses the documented bare `{{payload}}`
  whole-body substitution and asks the agent to parse the JSON itself, so it
  works either way. See the note at the bottom of that file.
- **Cost at scale**: not measured — no real session ran to completion (see
  "Blocked" above). This directly feeds #876's own open question; it cannot
  be answered until the billing blocker is resolved and a real trial batch
  runs.
- A stray repo, `AINative-Studio/test-permission-check-delete-me`, was
  created and archived (not deleted — this session's GitHub token lacks the
  `delete_repo` OAuth scope) while confirming org repo-creation permissions
  for this work. It is empty, private, and archived. A human with the right
  token scope should delete it.
