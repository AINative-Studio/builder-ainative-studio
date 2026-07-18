/**
 * Multi-file parser — splits Claude's output into separate files.
 * Looks for // --- FILE: path/to/file.tsx --- markers.
 */

import { generateAINativeFileSet } from './ainative-file-generator'
import { sanitizeForSandpack } from './code-validator'

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

  // Auto-inject missing imports, then re-sanitize each file so any pre-existing
  // duplicate imports / malformed ternaries survive into a clean, Sandpack-safe
  // file. Validation earlier ran on the whole blob, but per-file split + import
  // injection happen here — downstream of it (builder#64).
  for (const [path, content] of Object.entries(files)) {
    if (path.endsWith('.tsx') || path.endsWith('.jsx')) {
      files[path] = sanitizeForSandpack(injectMissingImports(content))
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
    const agentFiles = generateAINativeFileSet(userPrompt || '', Object.values(files).join('\n'))
    const axFileCount = Object.keys(agentFiles).length
    console.log(`📁 Adding ${axFileCount} AINative agent files to output`)
    for (const [name, content] of Object.entries(agentFiles)) {
      // Generator returns paths like 'public/robots.txt' and 'app/layout.tsx'
      files[`/${name}`] = content
    }
    console.log(`📦 Total files after AX injection: ${Object.keys(files).length}`, Object.keys(files))
  } catch (e) {
    console.error('Failed to generate AINative agent files:', e)
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

/**
 * The system prompt tells the model to use "Re"-prefixed recharts aliases
 * (ReLineChart, ReBarChart, RePieChart) and RechartsTooltip to avoid colliding
 * with lucide's LineChart/BarChart/PieChart. The injector must map those JSX
 * names back to real recharts exports via `as` aliases, or they render as
 * "ReLineChart is not defined" (builder#64). Key = JSX name used, value = real
 * recharts export.
 */
const RECHARTS_ALIASES: Record<string, string> = {
  ReLineChart: 'LineChart',
  ReBarChart: 'BarChart',
  RePieChart: 'PieChart',
  ReAreaChart: 'AreaChart',
  RechartsTooltip: 'Tooltip',
}

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

/** AIKit components available in Sandpack */
const AIKIT_COMPONENTS = [
  'MetricCard', 'AIKitPriceCard', 'AIKitRating', 'AgentCard', 'SwarmView',
  'SafetyBadge', 'GuardrailPanel', 'ChatBubble', 'StreamingIndicator', 'CodeDisplay',
  'TokenUsageBar', 'ConnectionStatus', 'AIKitHeader', 'AIKitSidebar', 'AIKitTable',
  'AIKitTimeline', 'AIKitBanner', 'AIKitAvatar', 'Skeleton', 'SkeletonCard',
  'EmptyState', 'AIKitProductCard', 'AIKitPagination', 'AIKitBreadcrumb',
  'AIKitStepper', 'AgentTimeline',
]

/**
 * Auto-inject missing imports for recharts, lucide-react, and AIKit.
 * Also fixes @/ import aliases to relative paths for Sandpack.
 */
/**
 * Collect every identifier already bound by an existing import in the code
 * (default, named, and aliased). Used to ensure auto-injection never adds a
 * name that's already imported from another module — which would produce
 * "Identifier 'X' has already been declared" in Sandpack (builder#64).
 */
function collectImportedNames(code: string): Set<string> {
  const names = new Set<string>()
  const importRe = /import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*['"][^'"]+['"]/g
  let m: RegExpExecArray | null
  while ((m = importRe.exec(code)) !== null) {
    if (m[1]) names.add(m[1].trim())
    if (m[2]) {
      for (const spec of m[2].split(',')) {
        const s = spec.trim()
        if (!s) continue
        names.add(s.split(/\s+as\s+/i).pop()!.trim())
      }
    }
  }
  return names
}

function injectMissingImports(code: string): string {
  // Fix @/components/ alias to relative paths (Sandpack doesn't support aliases)
  code = code.replace(/from ['"]@\/components\//g, "from './components/")
  code = code.replace(/from ['"]@\/lib\//g, "from './lib/")

  // Fix any remaining @/ aliases (e.g. @/utils, @/hooks, @/types)
  code = code.replace(/from ['"]@\//g, "from './")

  const imports: string[] = []

  // Names already imported anywhere in the file — never re-inject these, even
  // from a different module (e.g. LineChart/BarChart/PieChart exist in BOTH
  // lucide-react and recharts). Re-injecting caused duplicate-declaration
  // crashes in Sandpack (builder#64).
  const alreadyImported = collectImportedNames(code)

  // Check for AIKit component usage — skip any already imported individually
  const usedAikit = AIKIT_COMPONENTS.filter(c =>
    new RegExp(`<${c}[\\s/>]`).test(code) && !alreadyImported.has(c)
  )
  if (usedAikit.length > 0) {
    imports.push(`import { ${usedAikit.join(', ')} } from './components/aikit'`)
    usedAikit.forEach(c => alreadyImported.add(c))
  }

  // Check for recharts usage — real names AND the "Re"-prefixed aliases the
  // prompt instructs the model to use (ReLineChart → LineChart as ReLineChart).
  // Merge missing names as a separate `from 'recharts'` import even if one
  // already exists (ESM allows it; alreadyImported prevents name collisions),
  // so a used-but-unimported chart part no longer renders "X is not defined".
  const rechartsSpecs: string[] = []
  for (const real of RECHARTS_COMPONENTS) {
    if (new RegExp(`<${real}[\\s/>]`).test(code) && !alreadyImported.has(real)) {
      rechartsSpecs.push(real)
      alreadyImported.add(real)
    }
  }
  for (const [alias, real] of Object.entries(RECHARTS_ALIASES)) {
    if (new RegExp(`<${alias}[\\s/>]`).test(code) && !alreadyImported.has(alias)) {
      rechartsSpecs.push(`${real} as ${alias}`)
      alreadyImported.add(alias)
    }
  }
  if (rechartsSpecs.length > 0) {
    imports.push(`import { ${rechartsSpecs.join(', ')} } from 'recharts'`)
  }

  // Check for lucide-react usage — merge any missing icons even when a
  // lucide-react import already exists (the model often imports some icons but
  // uses more), so a used-but-unimported icon no longer renders "X is not
  // defined" (builder#64).
  const usedIcons = LUCIDE_ICONS.filter(icon =>
    new RegExp(`<${icon}[\\s/>]`).test(code) && !alreadyImported.has(icon)
  )
  if (usedIcons.length > 0) {
    imports.push(`import { ${usedIcons.join(', ')} } from 'lucide-react'`)
    usedIcons.forEach(c => alreadyImported.add(c))
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
