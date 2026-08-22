/**
 * Server-side quality gate for a generated app (formerly done client-side over
 * the shipped generated_code, #58). An entry qualifies when it has a chatId and
 * substantive, real-looking code: length >= 2000, and if it uses FILE markers,
 * its largest section defines a function/const. Keeping this on the server lets
 * us strip generated_code from the list payload entirely.
 *
 * Lives in lib/ (not the route file) because Next.js 15 route modules may only
 * export HTTP handlers + a small set of config fields — exporting a helper from
 * app/api/showcase/route.ts fails the production build ("isQualityApp is not a
 * valid Route export field").
 */
export function isQualityApp(code: string, chatId: string | undefined): boolean {
  if (!chatId || !code) return false
  if (code.length < 2000) return false
  if (code.includes('// --- FILE:')) {
    const sections = code.split(/\/\/\s*---\s*FILE:\s*/i)
    const mainSection = sections.reduce((a, b) => (a.length > b.length ? a : b), '')
    if (!mainSection.includes('function ') && !mainSection.includes('const ')) return false
  }
  return true
}
