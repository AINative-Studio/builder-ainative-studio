/**
 * Seed Built-in Commands
 *
 * Populates the database with pre-configured agent commands
 */

import { db } from './index';
import { agent_commands } from './schema';
import { BUILT_IN_COMMANDS } from '../data/built-in-commands';
import { eq } from 'drizzle-orm';

// System user ID for built-in commands (should be created during initial setup)
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000001';

const COMMAND_METADATA = [
  {
    name: 'Create Pull Request',
    description: 'Create a comprehensive pull request with automated PR description, testing validation, and CI/CD integration',
    category: 'development',
    icon: 'GitPullRequest',
    tags: ['git', 'pr', 'workflow', 'ci-cd'],
    shortcut: 'Cmd+Shift+P',
  },
  {
    name: 'Run Tests with Evidence',
    description: 'Execute test suite with coverage validation, evidence collection, and comprehensive reporting',
    category: 'testing',
    icon: 'TestTube',
    tags: ['testing', 'tdd', 'coverage', 'quality'],
    shortcut: 'Cmd+Shift+T',
  },
  {
    name: 'Deploy to Staging',
    description: 'Deploy application to staging environment with pre-deployment checks, migrations, and health monitoring',
    category: 'deployment',
    icon: 'Rocket',
    tags: ['deployment', 'ci-cd', 'staging', 'devops'],
    shortcut: 'Cmd+Shift+D',
  },
  {
    name: 'Generate Documentation',
    description: 'Generate comprehensive project documentation including API docs, user guides, and architecture diagrams',
    category: 'documentation',
    icon: 'FileText',
    tags: ['documentation', 'docs', 'readme', 'api'],
    shortcut: 'Cmd+Shift+G',
  },
  {
    name: 'Code Review Checklist',
    description: 'Perform thorough code review with automated checks for quality, security, performance, and test coverage',
    category: 'code-review',
    icon: 'GitPullRequest',
    tags: ['code-review', 'quality', 'security', 'best-practices'],
    shortcut: 'Cmd+Shift+R',
  },
];

export async function seedBuiltInCommands() {
  console.log('Seeding built-in commands...');

  try {
    // Check if commands already exist
    const existingCommands = await db
      .select()
      .from(agent_commands)
      .where(eq(agent_commands.is_built_in, true));

    if (existingCommands.length > 0) {
      console.log(`Found ${existingCommands.length} existing built-in commands. Skipping seed.`);
      return;
    }

    // Insert built-in commands
    const insertPromises = BUILT_IN_COMMANDS.map((command, index) => {
      const metadata = COMMAND_METADATA[index];

      return db.insert(agent_commands).values({
        name: metadata.name,
        description: metadata.description,
        category: metadata.category,
        icon: metadata.icon,
        tags: metadata.tags,
        author_id: SYSTEM_USER_ID,
        author_name: 'System',
        template: command.template,
        variables: command.variables as any,
        required_skills: command.requiredSkills,
        validation_rules: command.validationRules || [],
        pre_conditions: command.preConditions as any,
        checkpoints: command.checkpoints as any,
        output: command.output as any,
        version: command.version,
        is_built_in: true,
        is_team: false,
        is_active: true,
        shortcut: metadata.shortcut,
        estimated_token_cost: command.estimatedTokenCost,
        usage_count: 0,
      });
    });

    await Promise.all(insertPromises);

    console.log(`Successfully seeded ${BUILT_IN_COMMANDS.length} built-in commands`);
  } catch (error) {
    console.error('Error seeding built-in commands:', error);
    throw error;
  }
}

// Run if executed directly
if (require.main === module) {
  seedBuiltInCommands()
    .then(() => {
      console.log('Seed completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Seed failed:', error);
      process.exit(1);
    });
}
