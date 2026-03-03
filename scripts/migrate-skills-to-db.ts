#!/usr/bin/env tsx
/**
 * Migrate .claude/skills to database
 *
 * This script reads all skill markdown files from .claude/skills directory
 * and imports them into the PostgreSQL database.
 */

import * as fs from 'fs'
import * as path from 'path'
import { createSkill } from '../lib/db/queries'

interface SkillFrontmatter {
  name: string
  description: string
  tags?: string[]
  triggerPatterns?: string[]
  dependencies?: string[]
  version?: string
}

function parseFrontmatter(content: string): {
  frontmatter: SkillFrontmatter
  markdown: string
} {
  const frontmatterMatch = content.match(/^---\n([\s\S]+?)\n---\n([\s\S]*)$/)

  if (!frontmatterMatch) {
    throw new Error('No frontmatter found in skill file')
  }

  const [, frontmatterText, markdown] = frontmatterMatch
  const frontmatter: any = {}

  frontmatterText.split('\n').forEach((line) => {
    const match = line.match(/^(\w+):\s*(.+)$/)
    if (match) {
      const [, key, value] = match
      frontmatter[key] = value
    }
  })

  return { frontmatter, markdown: markdown.trim() }
}

function estimateTokens(text: string): number {
  // Rough estimate: ~4 characters per token
  return Math.ceil(text.length / 4)
}

function extractTags(description: string): string[] {
  const tags = new Set<string>()

  // Extract tags from description
  if (description.includes('git') || description.includes('commit')) tags.add('git')
  if (description.includes('test') || description.includes('TDD')) tags.add('testing')
  if (description.includes('file') || description.includes('placement')) tags.add('organization')
  if (description.includes('workflow')) tags.add('workflow')
  if (description.includes('deployment')) tags.add('deployment')
  if (description.includes('database') || description.includes('schema')) tags.add('database')
  if (description.includes('API')) tags.add('api')
  if (description.includes('security')) tags.add('security')
  if (description.includes('documentation')) tags.add('documentation')

  return Array.from(tags)
}

async function migrateSkillFile(filePath: string, skillId: string) {
  console.log(`\nProcessing: ${skillId}`)

  const content = fs.readFileSync(filePath, 'utf-8')
  const { frontmatter, markdown } = parseFrontmatter(content)

  // Extract metadata
  const name = frontmatter.name || skillId
  const description = frontmatter.description || ''
  const version = frontmatter.version || '1.0.0'

  // Estimate token costs
  const metadataTokens = estimateTokens(JSON.stringify({ name, description }))
  const fullTokens = estimateTokens(markdown)

  // Extract or generate tags
  const tags = frontmatter.tags || extractTags(description)
  if (tags.length === 0) tags.push('general')

  // Extract trigger patterns from description
  const triggerPatterns: string[] = []
  const descLower = description.toLowerCase()
  if (descLower.includes('when')) {
    const whenMatch = description.match(/when\s+\(([^)]+)\)/i)
    if (whenMatch) {
      const conditions = whenMatch[1].split(/,|\d+\)/)
      conditions.forEach((cond) => {
        const cleaned = cond
          .replace(/^\d+\)\s*/, '')
          .replace(/^[^\w]+/, '')
          .trim()
        if (cleaned) triggerPatterns.push(cleaned.toLowerCase())
      })
    }
  }

  console.log(`  Name: ${name}`)
  console.log(`  Version: ${version}`)
  console.log(`  Tags: ${tags.join(', ')}`)
  console.log(`  Trigger Patterns: ${triggerPatterns.length}`)
  console.log(`  Token Cost: ${metadataTokens} (metadata) / ${fullTokens} (full)`)

  try {
    // Get system user ID (should be created during migration)
    // For now, use a placeholder - should be replaced with actual system user ID
    const systemUserId = '00000000-0000-0000-0000-000000000001'

    await createSkill({
      id: skillId,
      name,
      description,
      version,
      authorId: systemUserId,
      authorName: 'System',
      authorEmail: 'system@ainative.com',
      tags,
      triggerPatterns: triggerPatterns.length > 0 ? triggerPatterns : undefined,
      dependencies: frontmatter.dependencies,
      tokenCostMetadata: metadataTokens,
      tokenCostFull: fullTokens,
      content: markdown,
      isBuiltIn: true,
    })

    console.log(`  ✓ Migrated successfully`)
  } catch (error: any) {
    if (error.message?.includes('duplicate key')) {
      console.log(`  ⚠ Already exists, skipping`)
    } else {
      console.error(`  ✗ Error:`, error.message)
    }
  }
}

async function main() {
  console.log('Migrating .claude/skills to database...\n')

  const skillsDir = path.join(process.cwd(), '.claude', 'skills')

  if (!fs.existsSync(skillsDir)) {
    console.error(`Skills directory not found: ${skillsDir}`)
    process.exit(1)
  }

  // Get all skill directories and files
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true })

  let migratedCount = 0
  let skippedCount = 0
  let errorCount = 0

  for (const entry of entries) {
    try {
      if (entry.isDirectory()) {
        // Check for SKILL.md in subdirectory
        const skillFile = path.join(skillsDir, entry.name, 'SKILL.md')
        if (fs.existsSync(skillFile)) {
          await migrateSkillFile(skillFile, entry.name)
          migratedCount++
        }
      } else if (entry.name.endsWith('.md')) {
        // Individual skill file
        const skillId = entry.name.replace('.md', '')
        const skillFile = path.join(skillsDir, entry.name)
        await migrateSkillFile(skillFile, skillId)
        migratedCount++
      }
    } catch (error: any) {
      console.error(`Error processing ${entry.name}:`, error.message)
      errorCount++
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log('Migration complete!')
  console.log(`  Migrated: ${migratedCount}`)
  console.log(`  Skipped: ${skippedCount}`)
  console.log(`  Errors: ${errorCount}`)
  console.log('='.repeat(60))
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
