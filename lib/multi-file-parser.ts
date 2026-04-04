/**
 * Multi-file parser — splits Claude's output into separate files.
 * Looks for // --- FILE: path/to/file.tsx --- markers.
 */

import { generateAINativeFileSet } from './ainative-file-generator'

const FILE_MARKER = /^\/\/\s*---\s*FILE:\s*(.+?)\s*---\s*$/

/**
 * Parse multi-file output from Claude into a file map.
 * Falls back to single-file if no markers found.
 */
export function parseMultiFileOutput(rawOutput: string, userPrompt?: string): Record<string, string> {
  const lines = rawOutput.split('\n')
  const files: Record<string, string> = {}
  let currentFile: string | null = null
  let currentContent: string[] = []

  for (const line of lines) {
    const match = line.match(FILE_MARKER)
    if (match) {
      // Save previous file
      if (currentFile) {
        files[normalizeFilePath(currentFile)] = currentContent.join('\n').trim()
      }
      currentFile = match[1].trim()
      currentContent = []
    } else {
      currentContent.push(line)
    }
  }

  // Save last file
  if (currentFile) {
    files[normalizeFilePath(currentFile)] = currentContent.join('\n').trim()
  }

  // Fallback: if no file markers found, treat entire output as single page
  if (Object.keys(files).length === 0) {
    // Strip markdown code fences if present
    let code = rawOutput
    const fenceMatch = code.match(/```(?:tsx?|jsx?|typescript|javascript)?\s*\n([\s\S]*?)```/)
    if (fenceMatch) {
      code = fenceMatch[1]
    }
    files['/src/App.tsx'] = code.trim()
  }

  // Ensure entry point exists
  if (!files['/src/App.tsx'] && !files['/App.tsx']) {
    // Find a component that looks like the main page
    const mainFile = Object.keys(files).find(
      f => f.includes('page.tsx') || f.includes('Page.tsx') || f.includes('App.tsx')
    )
    if (mainFile) {
      // Create an App.tsx that re-exports the main component
      const componentName = extractDefaultExport(files[mainFile])
      if (componentName) {
        files['/src/App.tsx'] = `import ${componentName} from '${mainFile.replace(/^\/src/, '.').replace(/\.tsx$/, '')}'\nexport default ${componentName}`
      }
    }
  }

  // Add AINative agent files (robots.txt, sitemap.xml, llms.txt, etc.)
  try {
    const agentFiles = generateAINativeFileSet(userPrompt || '', rawOutput)
    for (const [name, content] of Object.entries(agentFiles)) {
      files[`/public/${name}`] = content
    }
  } catch (e) {
    // Non-critical — agent files are optional
    console.warn('Failed to generate AINative agent files:', e)
  }

  return files
}

/** Normalize file paths to start with / */
function normalizeFilePath(path: string): string {
  if (!path.startsWith('/')) path = '/' + path
  return path
}

/** Extract the default export name from a component file */
function extractDefaultExport(code: string): string | null {
  const match = code.match(/export\s+default\s+function\s+(\w+)/)
    || code.match(/export\s+default\s+(\w+)/)
    || code.match(/function\s+([A-Z]\w+)\s*\(/)
  return match ? match[1] : null
}
