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

  // Auto-inject missing imports for recharts components
  for (const [path, content] of Object.entries(files)) {
    if (path.endsWith('.tsx') || path.endsWith('.jsx')) {
      files[path] = injectMissingImports(content)
    }
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
      // Generator returns paths like 'public/robots.txt' and 'app/layout.tsx'
      // Prefix with / for absolute path (no double-nesting)
      files[`/${name}`] = content
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

/** Recharts components that may be used in generated code */
const RECHARTS_COMPONENTS = [
  'ResponsiveContainer', 'LineChart', 'Line', 'BarChart', 'Bar', 'PieChart', 'Pie', 'Cell',
  'AreaChart', 'Area', 'RadarChart', 'Radar', 'RadialBarChart', 'RadialBar',
  'ComposedChart', 'Scatter', 'ScatterChart', 'Treemap', 'Funnel', 'FunnelChart',
  'XAxis', 'YAxis', 'CartesianGrid', 'Tooltip', 'Legend', 'PolarGrid',
  'PolarAngleAxis', 'PolarRadiusAxis',
]

/** Lucide icon names commonly used in generated code */
const LUCIDE_ICONS = [
  'Search', 'Menu', 'X', 'ChevronDown', 'ChevronRight', 'ChevronLeft', 'ChevronUp',
  'Home', 'Settings', 'Users', 'BarChart3', 'FileText', 'Bell', 'Mail', 'Star',
  'Heart', 'ShoppingCart', 'Plus', 'Minus', 'Edit', 'Trash2', 'Eye', 'Check',
  'AlertCircle', 'Info', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown',
  'ExternalLink', 'Download', 'Upload', 'Share2', 'Filter', 'Calendar', 'Clock',
  'MapPin', 'Phone', 'Globe', 'Lock', 'Shield', 'Zap', 'TrendingUp', 'TrendingDown',
  'Activity', 'DollarSign', 'CreditCard', 'Package', 'Truck', 'Sun', 'Moon',
  'Laptop', 'Smartphone', 'Code', 'Terminal', 'GitBranch', 'Send', 'MessageSquare',
  'Bookmark', 'Tag', 'Copy', 'Save', 'RefreshCw', 'MoreHorizontal', 'MoreVertical',
  'Layers', 'Layout', 'Grid', 'List', 'PieChart', 'LineChart', 'BarChart', 'Target',
  'Award', 'Sparkles', 'Rocket', 'Building2', 'Briefcase', 'BookOpen', 'Bot', 'Brain',
  'LogOut', 'LogIn', 'UserPlus', 'Users2', 'FolderOpen', 'File', 'Box', 'Inbox',
  'CircleDot', 'Hexagon', 'Wand2', 'Palette', 'Lightbulb', 'Gauge', 'Cpu', 'Wifi',
  'Play', 'Pause', 'SkipForward', 'Volume2', 'Image', 'Video', 'Music', 'Mic',
]

/**
 * Auto-inject missing imports for recharts and lucide-react.
 * Scans code for component usage and adds import statements if missing.
 */
function injectMissingImports(code: string): string {
  const imports: string[] = []

  // Check for recharts usage
  const usedRecharts = RECHARTS_COMPONENTS.filter(c =>
    new RegExp(`<${c}[\\s/>]`).test(code) && !code.includes(`from 'recharts'`) && !code.includes(`from "recharts"`)
  )
  if (usedRecharts.length > 0) {
    imports.push(`import { ${usedRecharts.join(', ')} } from 'recharts'`)
  }

  // Check for lucide-react usage
  if (!code.includes(`from 'lucide-react'`) && !code.includes(`from "lucide-react"`)) {
    const usedIcons = LUCIDE_ICONS.filter(icon =>
      new RegExp(`<${icon}[\\s/>]`).test(code)
    )
    if (usedIcons.length > 0) {
      imports.push(`import { ${usedIcons.join(', ')} } from 'lucide-react'`)
    }
  }

  if (imports.length === 0) return code

  // Insert after the last existing import, or at the top
  const lastImportIdx = code.lastIndexOf('\nimport ')
  if (lastImportIdx !== -1) {
    const endOfLine = code.indexOf('\n', lastImportIdx + 1)
    return code.slice(0, endOfLine + 1) + imports.join('\n') + '\n' + code.slice(endOfLine + 1)
  }

  // No imports at all — prepend
  return imports.join('\n') + '\n' + code
}
