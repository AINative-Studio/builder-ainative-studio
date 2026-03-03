/**
 * Claude Code Agent Profiles Integration
 * Loads and applies user's custom agent profiles from ~/.claude/agents
 */

import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface AgentProfile {
  name: string
  description: string
  model?: string
  color?: string
  scope?: string
  instructions: string
  frontmatter: Record<string, any>
}

/**
 * Parse agent profile markdown file
 */
function parseAgentProfile(content: string): AgentProfile {
  // Extract frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
  let frontmatter: Record<string, any> = {}
  let instructions = content

  if (frontmatterMatch) {
    // Parse YAML frontmatter (simple key: value parser)
    const frontmatterText = frontmatterMatch[1]
    frontmatterText.split('\n').forEach((line) => {
      const [key, ...valueParts] = line.split(':')
      if (key && valueParts.length > 0) {
        frontmatter[key.trim()] = valueParts.join(':').trim()
      }
    })

    // Remove frontmatter from instructions
    instructions = content.replace(frontmatterMatch[0], '').trim()
  }

  return {
    name: frontmatter.name || 'unknown',
    description: frontmatter.description || '',
    model: frontmatter.model,
    color: frontmatter.color,
    scope: frontmatter.scope,
    instructions,
    frontmatter,
  }
}

/**
 * Load all agent profiles from ~/.claude/agents
 */
export function loadAgentProfiles(): Map<string, AgentProfile> {
  const profiles = new Map<string, AgentProfile>()
  const agentsDir = join(homedir(), '.claude', 'agents')

  try {
    const files = readdirSync(agentsDir)

    for (const file of files) {
      if (file.endsWith('.md')) {
        const filePath = join(agentsDir, file)
        const content = readFileSync(filePath, 'utf-8')
        const profile = parseAgentProfile(content)
        profiles.set(profile.name, profile)
      }
    }

    console.log(`✅ Loaded ${profiles.size} agent profiles from ${agentsDir}`)
  } catch (error) {
    console.warn(`⚠️ Could not load agent profiles from ${agentsDir}:`, error)
  }

  return profiles
}

/**
 * Get agent profile by name
 */
export function getAgentProfile(name: string): AgentProfile | undefined {
  const profiles = loadAgentProfiles()
  return profiles.get(name)
}

/**
 * Get multiple agent profiles
 */
export function getAgentProfiles(names: string[]): AgentProfile[] {
  const profiles = loadAgentProfiles()
  return names.map((name) => profiles.get(name)).filter((p): p is AgentProfile => p !== undefined)
}

/**
 * Build comprehensive system prompt from multiple agent profiles
 */
export function buildSystemPromptFromProfiles(
  profileNames: string[],
  taskContext: string
): string {
  const profiles = getAgentProfiles(profileNames)

  if (profiles.length === 0) {
    return taskContext
  }

  let systemPrompt = `You are a specialized agent combining the expertise of multiple agent profiles:\n\n`

  profiles.forEach((profile, index) => {
    systemPrompt += `## Agent Profile ${index + 1}: ${profile.name}\n\n`
    systemPrompt += `${profile.instructions}\n\n`
    systemPrompt += `---\n\n`
  })

  systemPrompt += `## Current Task Context\n\n${taskContext}\n\n`
  systemPrompt += `Apply the combined expertise from all agent profiles above to complete this task with the highest quality standards.`

  return systemPrompt
}

/**
 * Build OPTIMIZED system prompt from agent profiles (30-40% token reduction)
 * Extracts only core competencies and essential instructions while maintaining quality
 */
export function buildOptimizedSystemPromptFromProfiles(
  profileNames: string[],
  taskContext: string
): string {
  const profiles = getAgentProfiles(profileNames)

  if (profiles.length === 0) {
    return taskContext
  }

  // Extract only the first section of instructions (typically Core Competencies/Responsibilities)
  // and role description, skipping verbose methodology and examples
  const expertiseSummary = profiles
    .map((profile) => {
      // Extract just the first major section (before second ## or **) plus description
      const instructionLines = profile.instructions.split('\n')
      const essentialLines: string[] = []
      let sectionCount = 0

      for (const line of instructionLines) {
        // Stop after capturing core competencies/responsibilities section
        if (line.startsWith('**') || line.startsWith('##')) {
          sectionCount++
          if (sectionCount > 2) break // Keep only first 2 sections
        }
        essentialLines.push(line)
        // Limit to ~400 tokens per profile
        if (essentialLines.length > 30) break
      }

      return `**${profile.name}**: ${profile.description}\n${essentialLines.join('\n').trim()}`
    })
    .join('\n\n---\n\n')

  return `You combine expertise from multiple specialized agents:\n\n${expertiseSummary}\n\n## Task\n\n${taskContext}\n\nApply this combined expertise to deliver production-quality results.`
}

/**
 * Agent profile mapping for different subagent types
 */
export const SUBAGENT_PROFILE_MAPPING = {
  design: ['ai-product-architect', 'system-architect'],
  code: ['frontend-ui-builder', 'ai-product-architect'],
  validation: ['qa-bug-hunter', 'test-engineer'],
  orchestrator: ['cody-team-leader'], // Cody leads the team with 30 years of experience
}
