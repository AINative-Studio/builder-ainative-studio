/**
 * Chunk Merger
 *
 * Combines multiple generated chunks into a single cohesive application.
 * Handles Phase 1 (core), Phase 2 (features), and Phase 3 (integration).
 */

import { GeneratedChunk } from './multi-pass-generator'

/**
 * Merge all chunks into final application code
 */
export function mergeChunks(chunks: GeneratedChunk[]): string {
  // Separate chunks by phase
  const coreChunk = chunks.find(c => c.phase === 1 && c.phaseType === 'core')
  const featureChunks = chunks.filter(c => c.phase === 2 && c.phaseType === 'feature')
  const integrationChunk = chunks.find(c => c.phase === 3 && c.phaseType === 'integration')

  if (!coreChunk || !coreChunk.success) {
    throw new Error('Core structure (Phase 1) failed or is missing - cannot merge')
  }

  // Start with core structure
  let mergedCode = coreChunk.code

  // Add feature chunks
  for (const featureChunk of featureChunks) {
    if (featureChunk.success) {
      mergedCode = mergeFeatureIntoCore(mergedCode, featureChunk.code)
    }
  }

  // Apply integration chunk (if exists and succeeded)
  if (integrationChunk && integrationChunk.success) {
    mergedCode = applyIntegration(mergedCode, integrationChunk.code)
  }

  // Final cleanup
  mergedCode = cleanupMergedCode(mergedCode)

  return mergedCode
}

/**
 * Merge a feature chunk into the core structure
 *
 * Strategy:
 * - Core provides: layout, types, mock data, routing structure
 * - Feature provides: page implementations and feature-specific components
 * - We replace placeholder pages with real implementations
 */
function mergeFeatureIntoCore(coreCode: string, featureCode: string): string {
  // Extract the main component from feature code
  // Feature chunks should only contain page implementations, not full app structure

  // Strategy: Feature code should have comments like "// INSERT INTO: <section>"
  // Or we can look for specific component definitions and merge them

  // For simplicity in V1: Append feature code after core
  // The feature code should be self-contained implementations
  // that reference the types/state from core

  // In a more sophisticated version, we'd parse AST and do smart merging
  // For now, we rely on careful prompt engineering in Phase 2

  return coreCode + '\n\n// ===== FEATURE CHUNK =====\n\n' + featureCode
}

/**
 * Apply integration chunk to merged code
 *
 * Integration chunk contains final touches:
 * - Cross-module navigation
 * - Shared error handling
 * - Final polish
 *
 * This can override parts of the merged code
 */
function applyIntegration(mergedCode: string, integrationCode: string): string {
  // Look for integration markers in the integration code
  // e.g., // REPLACE: ComponentName
  //       // WITH:
  //       [new code]

  // For V1: Add integration code that provides wrappers and enhancements
  return mergedCode + '\n\n// ===== INTEGRATION =====\n\n' + integrationCode
}

/**
 * Cleanup merged code
 * - Remove duplicate imports
 * - Remove duplicate type definitions
 * - Clean up comments and markers
 */
function cleanupMergedCode(code: string): string {
  let cleaned = code

  // Remove merge markers
  cleaned = cleaned.replace(/\/\/ ===== .* =====\n/g, '')

  // Remove excessive blank lines (more than 2)
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n')

  // Deduplicate imports (simple version)
  cleaned = deduplicateImports(cleaned)

  return cleaned
}

/**
 * Deduplicate import statements
 */
function deduplicateImports(code: string): string {
  const lines = code.split('\n')
  const imports = new Map<string, string>() // key: import source, value: full import statement
  const nonImportLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()

    // Check if it's an import statement
    if (trimmed.startsWith('import ') && trimmed.includes(' from ')) {
      // Extract source (what's after 'from')
      const fromMatch = trimmed.match(/from ['"]([^'"]+)['"]/)
      if (fromMatch) {
        const source = fromMatch[1]

        // If we haven't seen this import source, add it
        if (!imports.has(source)) {
          imports.set(source, line)
        } else {
          // Merge imports from same source
          const existing = imports.get(source)!
          imports.set(source, mergeImportStatements(existing, line))
        }
      } else {
        // Couldn't parse, keep as-is
        nonImportLines.push(line)
      }
    } else {
      nonImportLines.push(line)
    }
  }

  // Reconstruct code: imports first, then rest
  const deduplicatedImports = Array.from(imports.values())
  return [...deduplicatedImports, ...nonImportLines].join('\n')
}

/**
 * Merge two import statements from the same source
 */
function mergeImportStatements(import1: string, import2: string): string {
  // Simple version: Extract named imports and combine them
  // e.g., "import { A } from 'x'" + "import { B } from 'x'" = "import { A, B } from 'x'"

  const extractImports = (stmt: string): { names: Set<string>; source: string; default: string | null } => {
    const fromMatch = stmt.match(/from ['"]([^'"]+)['"]/)
    const source = fromMatch ? fromMatch[1] : ''

    // Check for default import
    const defaultMatch = stmt.match(/import\s+(\w+)\s+from/)
    const defaultImport = defaultMatch ? defaultMatch[1] : null

    // Extract named imports
    const namedMatch = stmt.match(/{\s*([^}]+)\s*}/)
    const names = new Set<string>()
    if (namedMatch) {
      namedMatch[1].split(',').forEach(name => {
        names.add(name.trim())
      })
    }

    return { names, source, default: defaultImport }
  }

  const imp1 = extractImports(import1)
  const imp2 = extractImports(import2)

  // Combine names
  const combinedNames = new Set([...imp1.names, ...imp2.names])

  // Use first default import if both exist
  const defaultImport = imp1.default || imp2.default

  // Reconstruct import statement
  const namedImports = Array.from(combinedNames).join(', ')
  const defaultPart = defaultImport ? `${defaultImport}${namedImports ? ', ' : ''}` : ''
  const namedPart = namedImports ? `{ ${namedImports} }` : ''

  return `import ${defaultPart}${namedPart} from '${imp1.source}'`
}

/**
 * Validate merged code structure
 */
export function validateMergedCode(mergedCode: string): {
  isValid: boolean
  warnings: string[]
  stats: {
    totalLines: number
    importCount: number
    componentCount: number
  }
} {
  const warnings: string[] = []

  // Count lines
  const lines = mergedCode.split('\n')
  const totalLines = lines.length

  // Count imports
  const importCount = lines.filter(l => l.trim().startsWith('import ')).length

  // Count components (rough estimate)
  const componentMatches = mergedCode.match(/function\s+[A-Z]\w+|const\s+[A-Z]\w+\s*=.*=>/g)
  const componentCount = componentMatches ? componentMatches.length : 0

  // Warnings
  if (totalLines < 100) {
    warnings.push('Merged code seems too short - possible merge failure')
  }

  if (componentCount === 0) {
    warnings.push('No components found in merged code')
  }

  if (importCount === 0) {
    warnings.push('No imports found - this is unusual')
  }

  // Check for duplicate component definitions
  const componentNames = new Set<string>()
  const duplicates: string[] = []

  if (componentMatches) {
    for (const match of componentMatches) {
      const nameMatch = match.match(/[A-Z]\w+/)
      if (nameMatch) {
        const name = nameMatch[0]
        if (componentNames.has(name)) {
          duplicates.push(name)
        }
        componentNames.add(name)
      }
    }
  }

  if (duplicates.length > 0) {
    warnings.push(`Duplicate component definitions: ${duplicates.join(', ')}`)
  }

  const isValid = warnings.length === 0 || warnings.every(w => !w.includes('failure'))

  return {
    isValid,
    warnings,
    stats: {
      totalLines,
      importCount,
      componentCount
    }
  }
}

/**
 * Get human-readable merge summary
 */
export function getMergeSummary(chunks: GeneratedChunk[], mergedCode: string): string {
  const validation = validateMergedCode(mergedCode)
  const successfulChunks = chunks.filter(c => c.success)

  const lines: string[] = []
  lines.push(`🔀 Merge Summary:`)
  lines.push(`   Chunks Merged: ${successfulChunks.length}/${chunks.length}`)
  lines.push(`   Total Lines: ${validation.stats.totalLines}`)
  lines.push(`   Components: ${validation.stats.componentCount}`)
  lines.push(`   Imports: ${validation.stats.importCount}`)
  lines.push(`   Validation: ${validation.isValid ? '✅ Passed' : '⚠️ Has warnings'}`)

  if (validation.warnings.length > 0) {
    lines.push(``)
    lines.push(`⚠️  Warnings:`)
    validation.warnings.forEach(w => {
      lines.push(`   - ${w}`)
    })
  }

  return lines.join('\n')
}
