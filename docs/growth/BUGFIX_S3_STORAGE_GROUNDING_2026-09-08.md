# Bugfix: Cody invented a fictitious AWS S3 bridge requirement

**Date:** 2026-09-08 · **Reported via:** WhatsApp screenshot, user kvvk99@gmail.com, product "dedux"

## What happened

A real user asked Cody, mid-conversation in `/build`, about ingesting AWS S3
bucket metadata (object names, sizes, timestamps, tags, storage class,
permissions, last-accessed) so their app's agents could analyze storage
patterns, compliance risk, and cost.

Cody's real reply: *"What you need to build: the AWS IAM + S3 API bridge
(credential handling, batch metadata pull, incremental sync), the Agent Cloud
task to run nightly, and the analysis logic itself (cost rollups, compliance
rules, anomaly detection). That's a real backend build, so it's in the paid
tier."*

This is wrong. ZeroDB already provides real, live, S3-compatible object
storage — confirmed via `lib/build/media-schedule.ts`'s working
`POST /v1/projects/{id}/files/upload` and `GET /v1/projects/{id}/files/{fileId}/download`
endpoints (comment there literally says "the same S3-backed files bucket the
platform owns"), and `docs/AINATIVE_PRIMITIVES.md:44`, which documents
"S3-compatible file storage" as part of ZeroDB. No custom AWS bridge is
needed to store or query object metadata inside a Builder-generated app.

(Separately, and not yet addressed: if a user's real ask is ingesting
metadata from a *pre-existing external* AWS account they already own —
distinct from storing new objects inside their Builder app — that may
genuinely require real AWS credentials/API integration. But Cody never
reached that distinction; the conversation never got past the false premise
that ZeroDB itself needed a bridge.)

## Root cause

Two-layer bug in the capability-grounding pipeline:

1. `lib/build/primitive-catalog.ts`'s ZeroDB entry (`purpose` and `triggers`)
   never said "S3", "AWS", "bucket", "object storage", or "metadata" anywhere
   — only the word "files," buried in a six-item list. `selectPrimitives()`
   did technically match this user's message (via generic triggers like
   `data`/`store`/`rag`) and injected a ZeroDB line into Cody's system prompt
   for this turn — but the fact was present in too vague a form to preempt
   the model from reasoning past it and inventing an AWS-bridge narrative
   instead.
2. The parallel human-facing catalog, `lib/build/capabilities.ts`, had the
   identical gap — but is only wired into the Help Center
   (`app/api/build/help/route.ts`), never into the live `/build` chat
   (`app/api/chat-ws/route.ts`) at all, so it couldn't have helped here
   regardless.

## Fix

Added explicit "S3-compatible," "s3," "aws," "bucket," "object storage,"
"upload," "download," "presigned," and "metadata" language to both catalog
entries' `purpose`/`build` prose and `triggers`/`keywords` arrays. Added a
regression test (`__tests__/lib/primitive-s3-storage-matching.test.ts`)
locking in that an S3/AWS/object-storage/metadata idea surfaces ZeroDB via
`selectPrimitives`, `getPrimitive`, `capabilityForPrimitive`, and
`retrieveCapabilities`.

## Related, separate finding: chat cannot edit an already-deployed app

The same investigation confirmed a second, larger, genuinely real gap: once
a company (like "dedux") is already deployed, there is **no real code path**
for the live `/build` chat to edit that company's existing app code. The
only "edit an existing generated app" capability in this codebase,
`lib/build/task-implementer.ts` (→ `task-resolver.ts`, invoked via
`fetchRepoFiles`/Gitea → LLM edit → `commitTaskWithPR` → `deployCompanyFromGitea`),
is wired exclusively to the autonomous nightly-loop backlog-task pipeline —
`app/api/chat-ws/route.ts` never calls it, and has no code path that loads a
company's real existing source as an edit target. A user typing "please
change X on my landing page" into an ongoing chat about an already-deployed
company has nothing that actually edits their live app today.

This is a real, substantial feature gap (wiring live chat into the existing
git-fetch → LLM-edit → commit → deploy pipeline), not a quick fix, and is
being tracked separately rather than attempted blind in this pass — see
issue #582 for scope and design.
