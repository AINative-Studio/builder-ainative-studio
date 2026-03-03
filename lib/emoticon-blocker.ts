/**
 * Emoticon Blocker Utility
 * Prevents emoticons in generated code, enforces icon library usage
 */

/**
 * Emoticon patterns to detect
 * Matches common emoji categories
 */
const EMOTICON_PATTERNS = [
  // Emoticons and emoji ranges
  /[\u{1F600}-\u{1F64F}]/gu, // Emoticons
  /[\u{1F300}-\u{1F5FF}]/gu, // Symbols & Pictographs
  /[\u{1F680}-\u{1F6FF}]/gu, // Transport & Map
  /[\u{1F1E0}-\u{1F1FF}]/gu, // Flags
  /[\u{2600}-\u{26FF}]/gu,   // Misc symbols
  /[\u{2700}-\u{27BF}]/gu,   // Dingbats (includes ✓, ✗, ✔, etc.)
  /[\u{1F900}-\u{1F9FF}]/gu, // Supplemental Symbols
  /[\u{1FA00}-\u{1FA6F}]/gu, // Extended symbols
  /[\u{1FA70}-\u{1FAFF}]/gu, // Symbols and Pictographs Extended-A
  // Additional check marks and symbols that might be missed
  /[✓✔✗✘×]/g,                 // Common check marks and crosses
]

/**
 * Check if code contains emoticons
 */
export function hasEmoticons(code: string): boolean {
  return EMOTICON_PATTERNS.some((pattern) => pattern.test(code))
}

/**
 * Find all emoticons in code
 */
export function findEmoticons(code: string): string[] {
  const found: string[] = []

  EMOTICON_PATTERNS.forEach((pattern) => {
    const matches = code.match(pattern)
    if (matches) {
      found.push(...matches)
    }
  })

  return [...new Set(found)] // Remove duplicates
}

/**
 * Remove all emoticons from code
 */
export function stripEmoticons(code: string): string {
  let cleanedCode = code

  // Remove emoticons - replace with space to avoid concatenating tokens
  EMOTICON_PATTERNS.forEach((pattern) => {
    cleanedCode = cleanedCode.replace(pattern, ' ')
  })

  // Clean up empty strings and extra spaces left after removal
  // IMPORTANT: Preserve newlines for readability and Babel parsing
  cleanedCode = cleanedCode
    .replace(/['"]\s+['"]|['"]['"]|``/g, '""') // Empty strings with spaces
    .replace(/className=""\s*/g, '') // Empty className
    .replace(/className="\s+"/g, '') // className with only spaces
    // Only remove excessive inline spaces, but preserve newlines for Babel
    .replace(/([^\n\r\t ])[ \t]{2,}/g, '$1 ') // Multiple inline spaces to single space
    .replace(/>\s*\n\s*</g, '>\n<') // Clean up whitespace around newlines between tags

  return cleanedCode
}

/**
 * Suggest icon library alternatives for common emoticons
 */
export function suggestIconLibraryAlternative(emoticon: string): string {
  const alternatives: Record<string, string> = {
    '🏠': '<Home className="w-4 h-4" /> // from lucide-react',
    '📊': '<BarChart className="w-4 h-4" /> // from lucide-react',
    '✅': '<Check className="w-4 h-4" /> // from lucide-react',
    '❌': '<X className="w-4 h-4" /> // from lucide-react',
    '⚙️': '<Settings className="w-4 h-4" /> // from lucide-react',
    '🔍': '<Search className="w-4 h-4" /> // from lucide-react',
    '📁': '<Folder className="w-4 h-4" /> // from lucide-react',
    '📄': '<File className="w-4 h-4" /> // from lucide-react',
    '👤': '<User className="w-4 h-4" /> // from lucide-react',
    '📧': '<Mail className="w-4 h-4" /> // from lucide-react',
    '🔔': '<Bell className="w-4 h-4" /> // from lucide-react',
    '💬': '<MessageSquare className="w-4 h-4" /> // from lucide-react',
    '📅': '<Calendar className="w-4 h-4" /> // from lucide-react',
    '⭐': '<Star className="w-4 h-4" /> // from lucide-react',
    '❤️': '<Heart className="w-4 h-4" /> // from lucide-react',
    '🔒': '<Lock className="w-4 h-4" /> // from lucide-react',
    '🔓': '<Unlock className="w-4 h-4" /> // from lucide-react',
    '⬇️': '<Download className="w-4 h-4" /> // from lucide-react',
    '⬆️': '<Upload className="w-4 h-4" /> // from lucide-react',
    '➕': '<Plus className="w-4 h-4" /> // from lucide-react',
    '✏️': '<Edit className="w-4 h-4" /> // from lucide-react',
    '🗑️': '<Trash className="w-4 h-4" /> // from lucide-react',
  }

  return alternatives[emoticon] || '<Icon /> // Use icon library instead of emoticon'
}

/**
 * Validate code doesn't use emoticons
 */
export function validateNoEmoticons(code: string): {
  valid: boolean
  emoticons: string[]
  suggestions: Array<{ emoticon: string; alternative: string }>
} {
  const emoticons = findEmoticons(code)
  const suggestions = emoticons.map((emoticon) => ({
    emoticon,
    alternative: suggestIconLibraryAlternative(emoticon),
  }))

  return {
    valid: emoticons.length === 0,
    emoticons,
    suggestions,
  }
}
