/**
 * Shared test harness for app/api route handlers (#1202 — Coverage Phase 2).
 *
 * Route handlers in this repo follow a near-identical shape: auth-gate (or
 * none) -> call into lib/ -> map the result (or a thrown error) onto a
 * NextResponse with the right status code. That repetition is exactly what
 * makes them templatable — this file is the one place that knows how to
 * build a NextRequest, a fake session, and a fake env so individual route
 * test files can stay short and focus on the behavior that's actually
 * specific to that route (its own branches, its own status-code mapping).
 *
 * Nothing here mocks real I/O itself — it only builds inputs. Each test file
 * still does its own `vi.mock(...)` of the specific lib/service/db module the
 * route under test imports; this harness just removes the boilerplate of
 * constructing NextRequest objects and session/env fixtures by hand.
 */
import { NextRequest } from 'next/server'

/** Build a NextRequest for a GET/DELETE-style call with no body. */
export function mockGetRequest(
  url: string,
  init?: { headers?: Record<string, string> }
): NextRequest {
  return new NextRequest(url, {
    method: 'GET',
    headers: init?.headers,
  })
}

/** Build a NextRequest carrying a JSON body (POST/PUT/PATCH). */
export function mockJsonRequest(
  url: string,
  body: unknown,
  init?: { method?: string; headers?: Record<string, string> }
): NextRequest {
  return new NextRequest(url, {
    method: init?.method ?? 'POST',
    headers: { 'content-type': 'application/json', ...init?.headers },
    body: JSON.stringify(body),
  })
}

/** Build a NextRequest with a raw text body (e.g. for HMAC-signed webhooks). */
export function mockTextRequest(
  url: string,
  text: string,
  init?: { method?: string; headers?: Record<string, string> }
): NextRequest {
  return new NextRequest(url, {
    method: init?.method ?? 'POST',
    headers: init?.headers,
    body: text,
  })
}

/** Build a NextRequest that throws on `.json()` — simulates a malformed body. */
export function mockMalformedJsonRequest(
  url: string,
  init?: { method?: string; headers?: Record<string, string> }
): NextRequest {
  return new NextRequest(url, {
    method: init?.method ?? 'POST',
    headers: { 'content-type': 'application/json', ...init?.headers },
    body: '{not valid json',
  })
}

/**
 * A minimal fake next-auth session shape as these routes read it:
 * `(session as any)?.accessToken`, sometimes `.user.id` / `.workspaceId`.
 * Routes never import a real session type, so this stays untyped-ish on
 * purpose — it mirrors what the handlers actually destructure.
 */
export interface FakeSession {
  accessToken?: string
  user?: { id?: string; email?: string }
  workspaceId?: string
  [key: string]: unknown
}

export function fakeSession(overrides: FakeSession = {}): FakeSession {
  return {
    accessToken: 'test-access-token',
    user: { id: 'user-1', email: 'founder@example.com' },
    ...overrides,
  }
}

/** The common "no session" case most auth-gated routes branch on. */
export const noSession = null

/**
 * Resolve `{ params: Promise<T> }` the way Next 15 route handlers receive
 * dynamic segments — params arrive as an already-awaited-shaped Promise.
 */
export function mockParams<T extends Record<string, string>>(params: T): { params: Promise<T> } {
  return { params: Promise.resolve(params) }
}

/** Parse a Response/NextResponse body as JSON, for assertions. */
export async function readJson(res: Response): Promise<any> {
  return res.json()
}
