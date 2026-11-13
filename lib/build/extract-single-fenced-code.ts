/**
 * Extract the body of a single markdown code fence from `content`, skipping
 * past any decoy ``` pair nested inside it (e.g. a JSDoc @example block) --
 * same bug class already fixed in lib/code-validator.ts's
 * extractCodeFromMarkdown and lib/sandbox-builder.ts's stripMarkdownFence
 * (#2004): a markdown fence delimiter is a BLOCK-level construct
 * (CommonMark) that must start a line, never prefixed by other text (a
 * JSDoc continuation's `" * "` prefix means its own decoy fence never
 * actually starts a line). The naive lazy `/```lang?\n([\s\S]*?)```/` regex
 * ignored this and matched the FIRST "```" found anywhere as the close,
 * discarding the real component declaration that followed a decoy fence
 * pair embedded in the real code's own JSDoc comment.
 *
 * Returns null when no valid open+close fence pair is found, so callers
 * can fall back to their own "treat the whole string as code" behavior.
 */
export function extractSingleFencedCode(
  content: string,
  langs = 'jsx|javascript|tsx|js|ts|typescript|react',
): string | null {
  const openFenceRe = new RegExp(`(?:^|\\n)[ \\t]{0,3}\`\`\`(?:${langs})?[ \\t]*\\n`)
  const openMatch = content.match(openFenceRe)
  if (!openMatch) return null

  const bodyStart = openMatch.index! + openMatch[0].length
  const closeFenceRe = /\n[ \t]{0,3}```[ \t]*(?=\n|$)/g
  closeFenceRe.lastIndex = bodyStart
  let lastClose: RegExpExecArray | null = null
  let cm: RegExpExecArray | null
  while ((cm = closeFenceRe.exec(content))) lastClose = cm
  if (!lastClose) return null

  return content.slice(bodyStart, lastClose.index).trim()
}
