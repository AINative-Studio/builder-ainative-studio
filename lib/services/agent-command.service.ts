/**
 * Agent Command Service
 *
 * Manages creation, execution, and tracking of agent commands for the
 * command palette system (Issue #17).
 *
 * Features:
 * - Command CRUD operations
 * - Variable substitution with validation
 * - Pre-condition checking
 * - Skill auto-loading
 * - Execution state management
 * - Progress tracking
 * - Fuzzy search with scoring
 */

import { db } from '@/lib/db';
import {
  agent_commands,
  command_favorites,
  command_executions,
  command_templates,
  type AgentCommandRecord,
  type CommandFavorite,
  type CommandExecution,
} from '@/lib/db/schema';
import {
  AgentCommand,
  CommandMetadata,
  CommandSearchQuery,
  CommandSearchResult,
  CommandExecutionContext,
  CommandExecutionState,
  CheckpointState,
  CommandValidationResult,
  CommandExportFormat,
  CommandVariable,
} from '@/lib/types/agent-commands';
import { eq, and, or, desc, asc, sql, inArray } from 'drizzle-orm';
import { getSkillService } from './agent-skill.service';

/**
 * Fuzzy search scoring algorithm
 */
function fuzzyScore(query: string, text: string): number {
  const normalizedQuery = query.toLowerCase();
  const normalizedText = text.toLowerCase();

  // Exact match = highest score
  if (normalizedText === normalizedQuery) return 1.0;

  // Starts with = high score
  if (normalizedText.startsWith(normalizedQuery)) return 0.9;

  // Contains = medium score
  if (normalizedText.includes(normalizedQuery)) return 0.7;

  // Calculate character matching ratio
  let matchCount = 0;
  let queryIndex = 0;

  for (let i = 0; i < normalizedText.length && queryIndex < normalizedQuery.length; i++) {
    if (normalizedText[i] === normalizedQuery[queryIndex]) {
      matchCount++;
      queryIndex++;
    }
  }

  const matchRatio = queryIndex / normalizedQuery.length;
  return matchRatio > 0.5 ? matchRatio * 0.6 : 0;
}

export class AgentCommandService {
  /**
   * Search commands with fuzzy matching
   */
  async searchCommands(
    userId: string,
    query: CommandSearchQuery
  ): Promise<CommandSearchResult> {
    const startTime = Date.now();

    try {
      // Build base query
      let whereConditions: any[] = [eq(agent_commands.is_active, true)];

      // Filter by category
      if (query.category) {
        whereConditions.push(eq(agent_commands.category, query.category));
      }

      // Filter by author
      if (query.authorId) {
        whereConditions.push(eq(agent_commands.author_id, query.authorId));
      }

      // Filter by built-in only
      if (query.builtInOnly) {
        whereConditions.push(eq(agent_commands.is_built_in, true));
      }

      // Filter by team only
      if (query.teamOnly) {
        whereConditions.push(eq(agent_commands.is_team, true));
      }

      // Get base results
      let results = await db
        .select()
        .from(agent_commands)
        .where(and(...whereConditions))
        .limit(query.limit || 50)
        .offset(query.offset || 0);

      // Get favorites if requested
      if (query.favoritesOnly) {
        const userFavorites = await db
          .select()
          .from(command_favorites)
          .where(eq(command_favorites.user_id, userId));

        const favoriteIds = userFavorites.map((f) => f.command_id);

        if (favoriteIds.length === 0) {
          return {
            commands: [],
            total: 0,
            searchTime: Date.now() - startTime,
            fuzzyMatch: false,
          };
        }

        results = results.filter((cmd) => favoriteIds.includes(cmd.id));
      }

      // Apply fuzzy search if query provided
      let scoredResults = results.map((record) => ({
        record,
        score: 0,
      }));

      if (query.query && query.query.trim()) {
        const searchQuery = query.query.trim();

        scoredResults = scoredResults.map((item) => {
          const nameScore = fuzzyScore(searchQuery, item.record.name) * 2.0; // Name matches weighted higher
          const descScore = fuzzyScore(searchQuery, item.record.description) * 1.0;
          const tagScore = item.record.tags
            .map((tag) => fuzzyScore(searchQuery, tag))
            .reduce((max, score) => Math.max(max, score), 0) * 1.5;

          return {
            ...item,
            score: Math.max(nameScore, descScore, tagScore),
          };
        });

        // Filter out low scores
        scoredResults = scoredResults.filter((item) => item.score > 0.3);
      }

      // Sort results
      switch (query.sortBy) {
        case 'recent':
          scoredResults.sort(
            (a, b) => b.record.created_at.getTime() - a.record.created_at.getTime()
          );
          break;
        case 'popular':
          scoredResults.sort((a, b) => b.record.usage_count - a.record.usage_count);
          break;
        case 'name':
          scoredResults.sort((a, b) => a.record.name.localeCompare(b.record.name));
          break;
        case 'category':
          scoredResults.sort((a, b) => a.record.category.localeCompare(b.record.category));
          break;
        case 'relevance':
        default:
          if (query.query) {
            scoredResults.sort((a, b) => b.score - a.score);
          }
          break;
      }

      // Convert to AgentCommand format
      const commands = await Promise.all(
        scoredResults.map((item) => this.recordToCommand(item.record, userId))
      );

      return {
        commands,
        total: commands.length,
        searchTime: Date.now() - startTime,
        fuzzyMatch: !!query.query,
      };
    } catch (error) {
      console.error('Command search error:', error);
      return {
        commands: [],
        total: 0,
        searchTime: Date.now() - startTime,
        fuzzyMatch: false,
      };
    }
  }

  /**
   * Get command by ID
   */
  async getCommand(commandId: string, userId: string): Promise<AgentCommand | null> {
    try {
      const [record] = await db
        .select()
        .from(agent_commands)
        .where(eq(agent_commands.id, commandId))
        .limit(1);

      if (!record) return null;

      return this.recordToCommand(record, userId);
    } catch (error) {
      console.error('Get command error:', error);
      return null;
    }
  }

  /**
   * Create a new command
   */
  async createCommand(
    command: Omit<AgentCommand, 'metadata'> & {
      metadata: Omit<CommandMetadata, 'id' | 'usageCount' | 'avgExecutionTime' | 'successRate' | 'createdAt' | 'updatedAt' | 'lastUsedAt'>;
    },
    userId: string
  ): Promise<AgentCommand> {
    try {
      const [record] = await db
        .insert(agent_commands)
        .values({
          name: command.metadata.name,
          description: command.metadata.description,
          category: command.metadata.category,
          icon: command.metadata.icon,
          tags: command.metadata.tags,
          author_id: userId,
          author_name: command.metadata.author.name,
          template: command.template,
          variables: command.variables as any,
          required_skills: command.requiredSkills,
          validation_rules: command.validationRules || [],
          pre_conditions: command.preConditions as any,
          checkpoints: command.checkpoints as any,
          output: command.output as any,
          version: command.version,
          is_built_in: command.metadata.isBuiltIn,
          is_team: command.metadata.isTeam,
          team_id: command.metadata.teamId,
          is_active: command.metadata.isActive,
          shortcut: command.metadata.shortcut,
          estimated_token_cost: command.estimatedTokenCost,
        })
        .returning();

      return this.recordToCommand(record, userId);
    } catch (error) {
      console.error('Create command error:', error);
      throw new Error('Failed to create command');
    }
  }

  /**
   * Update an existing command
   */
  async updateCommand(
    commandId: string,
    updates: Partial<AgentCommand>,
    userId: string
  ): Promise<AgentCommand> {
    try {
      const updateData: any = {
        updated_at: new Date(),
      };

      if (updates.metadata) {
        if (updates.metadata.name) updateData.name = updates.metadata.name;
        if (updates.metadata.description) updateData.description = updates.metadata.description;
        if (updates.metadata.category) updateData.category = updates.metadata.category;
        if (updates.metadata.icon !== undefined) updateData.icon = updates.metadata.icon;
        if (updates.metadata.tags) updateData.tags = updates.metadata.tags;
        if (updates.metadata.shortcut !== undefined) updateData.shortcut = updates.metadata.shortcut;
        if (updates.metadata.isActive !== undefined) updateData.is_active = updates.metadata.isActive;
      }

      if (updates.template !== undefined) updateData.template = updates.template;
      if (updates.variables !== undefined) updateData.variables = updates.variables;
      if (updates.requiredSkills !== undefined) updateData.required_skills = updates.requiredSkills;
      if (updates.validationRules !== undefined) updateData.validation_rules = updates.validationRules;
      if (updates.preConditions !== undefined) updateData.pre_conditions = updates.preConditions;
      if (updates.checkpoints !== undefined) updateData.checkpoints = updates.checkpoints;
      if (updates.output !== undefined) updateData.output = updates.output;
      if (updates.version !== undefined) updateData.version = updates.version;
      if (updates.estimatedTokenCost !== undefined) updateData.estimated_token_cost = updates.estimatedTokenCost;

      const [record] = await db
        .update(agent_commands)
        .set(updateData)
        .where(eq(agent_commands.id, commandId))
        .returning();

      return this.recordToCommand(record, userId);
    } catch (error) {
      console.error('Update command error:', error);
      throw new Error('Failed to update command');
    }
  }

  /**
   * Delete a command
   */
  async deleteCommand(commandId: string): Promise<void> {
    try {
      await db.delete(agent_commands).where(eq(agent_commands.id, commandId));
    } catch (error) {
      console.error('Delete command error:', error);
      throw new Error('Failed to delete command');
    }
  }

  /**
   * Toggle favorite status
   */
  async toggleFavorite(commandId: string, userId: string): Promise<boolean> {
    try {
      const existing = await db
        .select()
        .from(command_favorites)
        .where(
          and(
            eq(command_favorites.command_id, commandId),
            eq(command_favorites.user_id, userId)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        // Remove favorite
        await db
          .delete(command_favorites)
          .where(
            and(
              eq(command_favorites.command_id, commandId),
              eq(command_favorites.user_id, userId)
            )
          );
        return false;
      } else {
        // Add favorite
        await db.insert(command_favorites).values({
          command_id: commandId,
          user_id: userId,
        });
        return true;
      }
    } catch (error) {
      console.error('Toggle favorite error:', error);
      throw new Error('Failed to toggle favorite');
    }
  }

  /**
   * Substitute variables in template
   */
  substituteVariables(template: string, values: Record<string, any>): string {
    let result = template;

    for (const [key, value] of Object.entries(values)) {
      const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
      result = result.replace(regex, String(value));
    }

    return result;
  }

  /**
   * Validate variable values
   */
  validateVariables(
    variables: CommandVariable[],
    values: Record<string, any>
  ): { valid: boolean; errors: Record<string, string> } {
    const errors: Record<string, string> = {};

    for (const variable of variables) {
      const value = values[variable.name];

      // Check required
      if (variable.required && (value === undefined || value === null || value === '')) {
        errors[variable.name] = `${variable.label} is required`;
        continue;
      }

      // Skip validation if not provided and not required
      if (value === undefined || value === null) continue;

      // Type validation
      switch (variable.type) {
        case 'number':
          if (isNaN(Number(value))) {
            errors[variable.name] = `${variable.label} must be a number`;
          }
          break;
        case 'boolean':
          if (typeof value !== 'boolean') {
            errors[variable.name] = `${variable.label} must be true or false`;
          }
          break;
        case 'select':
          if (variable.options && !variable.options.some((opt) => opt.value === value)) {
            errors[variable.name] = `${variable.label} must be one of the available options`;
          }
          break;
        case 'multiselect':
          if (!Array.isArray(value)) {
            errors[variable.name] = `${variable.label} must be an array`;
          } else if (variable.options) {
            const validValues = variable.options.map((opt) => opt.value);
            const invalidValues = value.filter((v) => !validValues.includes(v));
            if (invalidValues.length > 0) {
              errors[variable.name] = `${variable.label} contains invalid values`;
            }
          }
          break;
        case 'url':
          try {
            new URL(String(value));
          } catch {
            errors[variable.name] = `${variable.label} must be a valid URL`;
          }
          break;
      }

      // Custom regex validation
      if (variable.validation && typeof value === 'string') {
        const regex = new RegExp(variable.validation);
        if (!regex.test(value)) {
          errors[variable.name] = variable.validationMessage || `${variable.label} is invalid`;
        }
      }
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors,
    };
  }

  /**
   * Execute a command
   */
  async executeCommand(
    command: AgentCommand,
    context: Omit<CommandExecutionContext, 'executionId' | 'startedAt'>
  ): Promise<CommandExecutionState> {
    const executionId = crypto.randomUUID();
    const fullContext: CommandExecutionContext = {
      ...context,
      executionId,
      startedAt: new Date(),
    };

    // Initialize execution state
    const state: CommandExecutionState = {
      context: fullContext,
      status: 'pending',
      currentCheckpointIndex: 0,
      checkpointStates: command.checkpoints.map((checkpoint) => ({
        checkpointId: checkpoint.id,
        status: 'pending',
      })),
      loadedSkills: [],
      preConditionResults: [],
      logs: [],
    };

    try {
      // Create execution record
      await db.insert(command_executions).values({
        command_id: command.metadata.id,
        user_id: context.userId,
        chat_id: context.chatId,
        variable_values: context.variableValues,
        git_context: context.gitContext,
        status: 'running',
        checkpoint_states: state.checkpointStates as any,
        pre_condition_results: state.preConditionResults as any,
        logs: state.logs as any,
      });

      state.status = 'running';
      this.addLog(state, 'info', 'Command execution started');

      // Check pre-conditions
      this.addLog(state, 'info', 'Checking pre-conditions');
      const preConditionsPassed = await this.checkPreConditions(command, state);

      if (!preConditionsPassed) {
        state.status = 'failed';
        state.error = {
          message: 'Pre-conditions failed',
        };
        this.addLog(state, 'error', 'Pre-condition checks failed');
        await this.saveExecutionState(executionId, state);
        return state;
      }

      // Load required skills
      if (command.requiredSkills.length > 0) {
        this.addLog(state, 'info', `Loading ${command.requiredSkills.length} required skills`);
        const skillService = getSkillService();

        for (const skillId of command.requiredSkills) {
          try {
            const skill = await skillService.loadFullSkill(skillId);
            state.loadedSkills.push(skill);
            this.addLog(state, 'info', `Loaded skill: ${skill.metadata.name}`);
          } catch (error) {
            this.addLog(state, 'warning', `Failed to load skill: ${skillId}`);
          }
        }
      }

      // Substitute variables in template
      const prompt = this.substituteVariables(command.template, context.variableValues);
      this.addLog(state, 'info', 'Template variables substituted');

      // Mark as completed
      state.status = 'completed';
      state.completedAt = new Date();
      state.executionTime = state.completedAt.getTime() - fullContext.startedAt.getTime();

      this.addLog(state, 'info', `Command execution completed in ${state.executionTime}ms`);

      // Save final state
      await this.saveExecutionState(executionId, state);

      // Update command statistics
      await this.updateCommandStats(command.metadata.id, true, state.executionTime);

      return state;
    } catch (error) {
      state.status = 'failed';
      state.error = {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      };
      state.completedAt = new Date();
      state.executionTime = state.completedAt.getTime() - fullContext.startedAt.getTime();

      this.addLog(state, 'error', `Command execution failed: ${state.error.message}`);

      await this.saveExecutionState(executionId, state);
      await this.updateCommandStats(command.metadata.id, false, state.executionTime);

      return state;
    }
  }

  /**
   * Get execution history for a command
   */
  async getExecutionHistory(
    commandId: string,
    userId: string,
    limit: number = 20
  ): Promise<CommandExecution[]> {
    try {
      return await db
        .select()
        .from(command_executions)
        .where(
          and(
            eq(command_executions.command_id, commandId),
            eq(command_executions.user_id, userId)
          )
        )
        .orderBy(desc(command_executions.started_at))
        .limit(limit);
    } catch (error) {
      console.error('Get execution history error:', error);
      return [];
    }
  }

  /**
   * Get recent commands for a user
   */
  async getRecentCommands(userId: string, limit: number = 10): Promise<AgentCommand[]> {
    try {
      const recentExecutions = await db
        .select({ command_id: command_executions.command_id })
        .from(command_executions)
        .where(eq(command_executions.user_id, userId))
        .orderBy(desc(command_executions.started_at))
        .limit(limit);

      const commandIds = [...new Set(recentExecutions.map((e) => e.command_id))];

      if (commandIds.length === 0) return [];

      const records = await db
        .select()
        .from(agent_commands)
        .where(inArray(agent_commands.id, commandIds));

      return Promise.all(records.map((record) => this.recordToCommand(record, userId)));
    } catch (error) {
      console.error('Get recent commands error:', error);
      return [];
    }
  }

  // Private helper methods

  private async recordToCommand(
    record: AgentCommandRecord,
    userId: string
  ): Promise<AgentCommand> {
    // Check if favorited
    const [favorite] = await db
      .select()
      .from(command_favorites)
      .where(
        and(
          eq(command_favorites.command_id, record.id),
          eq(command_favorites.user_id, userId)
        )
      )
      .limit(1);

    return {
      metadata: {
        id: record.id,
        name: record.name,
        description: record.description,
        category: record.category as any,
        icon: record.icon || undefined,
        tags: record.tags,
        author: {
          id: record.author_id,
          name: record.author_name,
        },
        isBuiltIn: record.is_built_in,
        isTeam: record.is_team,
        teamId: record.team_id || undefined,
        usageCount: record.usage_count,
        avgExecutionTime: record.avg_execution_time_ms || undefined,
        successRate: record.success_rate ? record.success_rate / 100 : undefined,
        isActive: record.is_active,
        shortcut: record.shortcut || undefined,
        isFavorite: !!favorite,
        createdAt: record.created_at,
        updatedAt: record.updated_at,
      },
      template: record.template,
      variables: record.variables as any,
      requiredSkills: record.required_skills,
      preConditions: record.pre_conditions as any,
      checkpoints: record.checkpoints as any,
      output: record.output as any,
      validationRules: record.validation_rules || undefined,
      estimatedTokenCost: record.estimated_token_cost || undefined,
      version: record.version,
    };
  }

  private async checkPreConditions(
    command: AgentCommand,
    state: CommandExecutionState
  ): Promise<boolean> {
    let allPassed = true;

    for (const condition of command.preConditions) {
      const result = {
        conditionId: condition.id,
        passed: true,
        message: undefined as string | undefined,
      };

      // Simple pre-condition checks (extend as needed)
      switch (condition.type) {
        case 'git_status':
          if (condition.config.gitStatus === 'clean' && state.context.gitContext?.hasUncommittedChanges) {
            result.passed = false;
            result.message = 'Git working directory must be clean';
          }
          break;
        // Add more pre-condition types as needed
      }

      state.preConditionResults.push(result);

      if (!result.passed && condition.blocking) {
        allPassed = false;
        this.addLog(state, 'error', `Pre-condition failed: ${condition.description}`);
      }
    }

    return allPassed;
  }

  private addLog(
    state: CommandExecutionState,
    level: 'info' | 'warning' | 'error',
    message: string,
    data?: any
  ): void {
    state.logs.push({
      timestamp: new Date(),
      level,
      message,
      data,
    });
  }

  private async saveExecutionState(
    executionId: string,
    state: CommandExecutionState
  ): Promise<void> {
    try {
      await db
        .update(command_executions)
        .set({
          status: state.status,
          current_checkpoint_index: state.currentCheckpointIndex,
          checkpoint_states: state.checkpointStates as any,
          pre_condition_results: state.preConditionResults as any,
          logs: state.logs as any,
          output: state.output as any,
          execution_time_ms: state.executionTime,
          success: state.status === 'completed',
          error: state.error as any,
          completed_at: state.completedAt,
        })
        .where(eq(command_executions.id, executionId));
    } catch (error) {
      console.error('Save execution state error:', error);
    }
  }

  private async updateCommandStats(
    commandId: string,
    success: boolean,
    executionTime: number
  ): Promise<void> {
    try {
      // Increment usage count
      await db
        .update(agent_commands)
        .set({
          usage_count: sql`${agent_commands.usage_count} + 1`,
        })
        .where(eq(agent_commands.id, commandId));

      // Update average execution time and success rate
      // (simplified version - proper implementation would calculate running average)
      await db
        .update(agent_commands)
        .set({
          avg_execution_time_ms: executionTime,
          success_rate: success ? 100 : 0,
        })
        .where(eq(agent_commands.id, commandId));
    } catch (error) {
      console.error('Update command stats error:', error);
    }
  }
}

// Singleton instance
let commandServiceInstance: AgentCommandService | null = null;

export function getCommandService(): AgentCommandService {
  if (!commandServiceInstance) {
    commandServiceInstance = new AgentCommandService();
  }
  return commandServiceInstance;
}
