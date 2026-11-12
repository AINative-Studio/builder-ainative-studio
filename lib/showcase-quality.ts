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
/**
 * Blank out string/template-literal and block-comment content, char-for-
 * char (newlines preserved so offsets still line up with the original
 * text). Deliberately leaves `//` line comments untouched — a genuine
 * `// --- FILE:` marker IS a line comment, so masking line comments too
 * would blank real markers right along with decoy ones. Same shape as
 * lib/code-validator.ts's extractRenderableCode fix (#1962).
 */
function maskStringsAndBlockCommentsForFileMarkerScan(content: string): string {
  let out = ''
  let i = 0
  while (i < content.length) {
    const ch = content[i]
    const next = content[i + 1]
    if (ch === '"' || ch === "'") {
      let j = i + 1
      while (j < content.length && content[j] !== ch) {
        if (content[j] === '\\') j++
        j++
      }
      const end = j >= content.length ? content.length - 1 : j
      out += content.slice(i, end + 1).replace(/[^\n]/g, ' ')
      i = end + 1
      continue
    }
    if (ch === '`') {
      let j = i + 1
      while (j < content.length && content[j] !== '`') {
        if (content[j] === '\\') j++
        j++
      }
      const end = j >= content.length ? content.length - 1 : j
      out += content.slice(i, end + 1).replace(/[^\n]/g, ' ')
      i = end + 1
      continue
    }
    if (ch === '/' && next === '*') {
      let end = content.indexOf('*/', i + 2)
      end = end === -1 ? content.length : end + 2
      out += content.slice(i, Math.min(end, content.length)).replace(/[^\n]/g, ' ')
      i = Math.min(end, content.length)
      continue
    }
    out += ch
    i++
  }
  return out
}

/**
 * Split `content` on `// --- FILE:` markers, verified against a string/
 * template/block-comment-masked view so a decoy marker-shaped substring
 * sitting inside a file's own string, template literal, or block comment
 * isn't mistaken for a real file boundary. Real bug found live (this
 * loop's overnight comment/string-blindness sweep, same class as
 * #1933/#1939/#1945/#1949/#1962/#1977/#1978/#1981/#1983): isQualityApp used
 * to gate on `code.includes('// --- FILE:')` then `code.split(...)`
 * directly against the raw, unmasked code, with the marker regex not
 * anchored to a full line — a decoy anywhere (including inside a
 * single-line string) could corrupt `mainSection`, wrongly excluding a
 * genuinely substantive app from the public showcase.
 */
function splitOnRealFileMarkers(content: string): string[] {
  const masked = maskStringsAndBlockCommentsForFileMarkerScan(content)
  const marker = /\/\/\s*---\s*FILE:\s*/gi
  const parts: string[] = []
  let lastEnd = 0
  let m: RegExpExecArray | null
  while ((m = marker.exec(masked)) !== null) {
    parts.push(content.slice(lastEnd, m.index))
    lastEnd = m.index + m[0].length
  }
  parts.push(content.slice(lastEnd))
  return parts
}

export function isQualityApp(code: string, chatId: string | undefined): boolean {
  if (!chatId || !code) return false
  if (code.length < 2000) return false
  const sections = splitOnRealFileMarkers(code)
  if (sections.length > 1) {
    const mainSection = sections.reduce((a, b) => (a.length > b.length ? a : b), '')
    if (!mainSection.includes('function ') && !mainSection.includes('const ')) return false
  }
  return true
}
