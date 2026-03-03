/**
 * Agent Skill Service
 *
 * Manages loading, caching, and recommendation of agent skills.
 * Implements progressive disclosure to optimize token usage.
 *
 * Inspired by .claude/skills achieving 82% token reduction
 * (4,556 tokens → 800 tokens baseline)
 */

import {
  AgentSkill,
  SkillMetadata,
  SkillLoadState,
  SkillContext,
  SkillRecommendation,
  SkillSearchQuery,
  SkillSearchResult,
  SkillTrigger,
  SkillUsageStats,
} from '@/lib/types/agent-skills';

export class AgentSkillService {
  private loadedSkills: Map<string, AgentSkill> = new Map();
  private skillStates: Map<string, SkillLoadState> = new Map();
  private usageStats: Map<string, SkillUsageStats> = new Map();

  /**
   * Load skill metadata only (lightweight, ~100 tokens)
   */
  async loadMetadata(skillId: string): Promise<SkillMetadata> {
    const startTime = Date.now();

    // TODO: Fetch from database
    const metadata = await this.fetchSkillMetadata(skillId);

    // Update load state
    this.skillStates.set(skillId, {
      skillId,
      metadataLoaded: true,
      contentLoaded: false,
      referencesLoaded: false,
      loadedAt: new Date(),
      loadTime: Date.now() - startTime,
    });

    return metadata;
  }

  /**
   * Load full skill content (on-demand, ~2000 tokens)
   */
  async loadFullSkill(skillId: string): Promise<AgentSkill> {
    const startTime = Date.now();

    // Check if already loaded
    if (this.loadedSkills.has(skillId)) {
      return this.loadedSkills.get(skillId)!;
    }

    // TODO: Fetch from database
    const skill = await this.fetchFullSkill(skillId);

    // Cache the skill
    this.loadedSkills.set(skillId, skill);

    // Update load state
    const state = this.skillStates.get(skillId);
    this.skillStates.set(skillId, {
      ...state,
      skillId,
      metadataLoaded: true,
      contentLoaded: true,
      referencesLoaded: false,
      loadedAt: new Date(),
      loadTime: Date.now() - startTime,
    });

    // Track usage
    this.trackUsage(skillId, 'manual');

    return skill;
  }

  /**
   * Recommend skills based on context
   */
  async recommendSkills(
    context: SkillContext
  ): Promise<SkillRecommendation[]> {
    const recommendations: SkillRecommendation[] = [];

    // Get all available skills (metadata only)
    const allSkills = await this.searchSkills({
      limit: 100,
    });

    for (const skillMeta of allSkills.skills) {
      const score = this.calculateRelevanceScore(skillMeta, context);

      if (score.confidence > 0.3) {
        recommendations.push({
          skill: skillMeta,
          reason: score.reason,
          confidence: score.confidence,
          autoLoad: score.confidence > 0.7,
        });
      }
    }

    // Sort by confidence
    recommendations.sort((a, b) => b.confidence - a.confidence);

    return recommendations.slice(0, 5); // Top 5 recommendations
  }

  /**
   * Auto-trigger skills based on context
   */
  async autoTriggerSkills(context: SkillContext): Promise<AgentSkill[]> {
    const recommendations = await this.recommendSkills(context);
    const autoLoadSkills: AgentSkill[] = [];

    for (const rec of recommendations) {
      if (rec.autoLoad) {
        // Check token budget
        if (this.hasTokenBudget(rec.skill, context.tokenBudget)) {
          const skill = await this.loadFullSkill(rec.skill.id);
          autoLoadSkills.push(skill);

          // Track auto-trigger
          this.trackUsage(rec.skill.id, 'auto');
        }
      }
    }

    return autoLoadSkills;
  }

  /**
   * Search skills
   */
  async searchSkills(query: SkillSearchQuery): Promise<SkillSearchResult> {
    const startTime = Date.now();

    // Import dynamically to avoid circular dependencies
    const { getAllActiveSkills } = await import('@/lib/db/queries');
    const dbSkills = await getAllActiveSkills();

    // Convert database skills to metadata
    let skills: SkillMetadata[] = dbSkills.map(skill => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      version: skill.version,
      author: {
        id: skill.author_id,
        name: skill.author_name,
        email: skill.author_email ?? undefined,
      },
      tags: skill.tags,
      triggerPatterns: skill.trigger_patterns ?? undefined,
      dependencies: skill.dependencies ?? undefined,
      tokenCost: {
        metadata: skill.token_cost_metadata,
        full: skill.token_cost_full,
      },
      compatibility: skill.compatibility ?? undefined,
      createdAt: new Date(skill.created_at),
      updatedAt: new Date(skill.updated_at),
    }));

    // Apply filters
    if (query.query) {
      const searchTerm = query.query.toLowerCase();
      skills = skills.filter(skill =>
        skill.name.toLowerCase().includes(searchTerm) ||
        skill.description.toLowerCase().includes(searchTerm) ||
        skill.tags.some(tag => tag.toLowerCase().includes(searchTerm))
      );
    }

    if (query.tags && query.tags.length > 0) {
      skills = skills.filter(skill =>
        query.tags!.some(tag => skill.tags.includes(tag))
      );
    }

    if (query.authorId) {
      skills = skills.filter(skill => skill.author.id === query.authorId);
    }

    if (query.frameworks && query.frameworks.length > 0) {
      skills = skills.filter(skill =>
        skill.compatibility?.frameworks?.some(fw =>
          query.frameworks!.includes(fw)
        )
      );
    }

    if (query.languages && query.languages.length > 0) {
      skills = skills.filter(skill =>
        skill.compatibility?.languages?.some(lang =>
          query.languages!.includes(lang)
        )
      );
    }

    // Apply sorting
    if (query.sortBy === 'name') {
      skills.sort((a, b) => a.name.localeCompare(b.name));
    } else if (query.sortBy === 'recent') {
      skills.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }

    // Apply pagination
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 50;
    const total = skills.length;
    const paginatedSkills = skills.slice(offset, offset + limit);

    return {
      skills: paginatedSkills,
      total,
      searchTime: Date.now() - startTime,
    };
  }

  /**
   * Get loaded skills state
   */
  getLoadedSkillsState(): SkillLoadState[] {
    return Array.from(this.skillStates.values());
  }

  /**
   * Calculate token usage for loaded skills
   */
  calculateTokenUsage(): {
    metadata: number;
    content: number;
    total: number;
  } {
    let metadataTokens = 0;
    let contentTokens = 0;

    for (const [skillId, state] of this.skillStates) {
      const skill = this.loadedSkills.get(skillId);
      if (!skill) continue;

      if (state.metadataLoaded) {
        metadataTokens += skill.metadata.tokenCost.metadata;
      }
      if (state.contentLoaded) {
        contentTokens += skill.metadata.tokenCost.full;
      }
    }

    return {
      metadata: metadataTokens,
      content: contentTokens,
      total: metadataTokens + contentTokens,
    };
  }

  /**
   * Unload skills to free up token budget
   */
  async unloadSkills(skillIds: string[]): Promise<void> {
    for (const skillId of skillIds) {
      this.loadedSkills.delete(skillId);
      this.skillStates.delete(skillId);
    }
  }

  /**
   * Get usage statistics for a skill
   */
  getUsageStats(skillId: string): SkillUsageStats | undefined {
    return this.usageStats.get(skillId);
  }

  // Private helper methods

  private async fetchSkillMetadata(skillId: string): Promise<SkillMetadata> {
    // Import dynamically to avoid circular dependencies
    const { getSkillById } = await import('@/lib/db/queries');
    const skill = await getSkillById(skillId);

    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }

    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      version: skill.version,
      author: {
        id: skill.author_id,
        name: skill.author_name,
        email: skill.author_email ?? undefined,
      },
      tags: skill.tags,
      triggerPatterns: skill.trigger_patterns ?? undefined,
      dependencies: skill.dependencies ?? undefined,
      tokenCost: {
        metadata: skill.token_cost_metadata,
        full: skill.token_cost_full,
      },
      compatibility: skill.compatibility ?? undefined,
      createdAt: new Date(skill.created_at),
      updatedAt: new Date(skill.updated_at),
    };
  }

  private async fetchFullSkill(skillId: string): Promise<AgentSkill> {
    // Import dynamically to avoid circular dependencies
    const { getSkillById } = await import('@/lib/db/queries');
    const skill = await getSkillById(skillId);

    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }

    const metadata: SkillMetadata = {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      version: skill.version,
      author: {
        id: skill.author_id,
        name: skill.author_name,
        email: skill.author_email ?? undefined,
      },
      tags: skill.tags,
      triggerPatterns: skill.trigger_patterns ?? undefined,
      dependencies: skill.dependencies ?? undefined,
      tokenCost: {
        metadata: skill.token_cost_metadata,
        full: skill.token_cost_full,
      },
      compatibility: skill.compatibility ?? undefined,
      createdAt: new Date(skill.created_at),
      updatedAt: new Date(skill.updated_at),
    };

    return {
      metadata,
      content: skill.content,
      references: skill.references ?? undefined,
      examples: skill.examples ?? undefined,
      validationRules: skill.validation_rules ?? undefined,
      commands: skill.commands ?? undefined,
    };
  }

  private calculateRelevanceScore(
    skill: SkillMetadata,
    context: SkillContext
  ): { confidence: number; reason: string } {
    let confidence = 0;
    let reasons: string[] = [];

    // Check trigger patterns
    if (skill.triggerPatterns) {
      for (const pattern of skill.triggerPatterns) {
        const recentMessage = context.recentMessages?.join(' ') || '';
        if (this.matchesPattern(pattern, recentMessage)) {
          confidence += 0.4;
          reasons.push(`matches trigger pattern: ${pattern}`);
        }
      }
    }

    // Check file context
    if (context.currentFile && skill.compatibility?.frameworks) {
      const fileExt = context.currentFile.split('.').pop();
      if (fileExt === 'ts' || fileExt === 'tsx') {
        confidence += 0.2;
        reasons.push('TypeScript file context');
      }
    }

    // Check git context
    if (context.gitContext?.hasUncommittedChanges) {
      if (skill.tags.includes('git') || skill.tags.includes('commit')) {
        confidence += 0.3;
        reasons.push('uncommitted changes detected');
      }
    }

    return {
      confidence: Math.min(confidence, 1.0),
      reason: reasons.join(', '),
    };
  }

  private matchesPattern(pattern: string, text: string): boolean {
    // Simple pattern matching
    // TODO: Implement regex and semantic matching
    return text.toLowerCase().includes(pattern.toLowerCase());
  }

  private hasTokenBudget(
    skill: SkillMetadata,
    budget?: { total: number; used: number; remaining: number }
  ): boolean {
    if (!budget) return true;

    const requiredTokens = skill.tokenCost.full;
    return budget.remaining >= requiredTokens * 2; // Keep 2x headroom
  }

  private trackUsage(skillId: string, type: 'manual' | 'auto'): void {
    const stats = this.usageStats.get(skillId) || {
      skillId,
      loadCount: 0,
      autoTriggerCount: 0,
      manualInvokeCount: 0,
      avgLoadTime: 0,
      lastUsedAt: new Date(),
    };

    stats.loadCount += 1;
    if (type === 'auto') {
      stats.autoTriggerCount += 1;
    } else {
      stats.manualInvokeCount += 1;
    }
    stats.lastUsedAt = new Date();

    this.usageStats.set(skillId, stats);
  }
}

// Singleton instance
let skillServiceInstance: AgentSkillService | null = null;

export function getSkillService(): AgentSkillService {
  if (!skillServiceInstance) {
    skillServiceInstance = new AgentSkillService();
  }
  return skillServiceInstance;
}
