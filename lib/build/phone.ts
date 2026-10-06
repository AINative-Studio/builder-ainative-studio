/**
 * Pure phone-number normalization, deliberately split out of lib/build/otp.ts
 * (#BLD-02d follow-up fix). otp.ts pulls in lib/jobs/alerting.ts, which
 * statically imports the real Postgres driver (lib/db/connection.ts,
 * Node-only: net/tls/perf_hooks) -- fine for server routes, but otp.ts is
 * also imported by the CLIENT component Auth.tsx (for this exact function),
 * which bundled that whole Node-only chain into client JS and broke the
 * build (confirmed in CI: "Module not found: Can't resolve 'net'", twice --
 * once via a static import, once still via a dynamic import, since webpack
 * still needs to resolve the dynamically-imported module's own dependency
 * graph to build its chunk). The only real fix is for the client to never
 * import anything that is even transitively reachable from otp.ts's
 * server-only alerting wiring -- hence this standalone, dependency-free module.
 */
export function toE164(raw: string): string | null {
  const trimmed = (raw || '').trim()
  if (!trimmed) return null
  if (trimmed.startsWith('+')) {
    const digits = trimmed.slice(1).replace(/\D/g, '')
    if (digits.length < 8 || digits.length > 15) return null
    return `+${digits}`
  }
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`
  return null
}
