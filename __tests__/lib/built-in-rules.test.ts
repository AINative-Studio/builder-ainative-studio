/**
 * Unit tests for the built-in enforcement rules.
 *
 * Covers every built-in rule's `check()` behaviour (pass + fail paths) and the
 * rule-level `autoFix()` for the two auto-fixable rules.
 */

import { describe, it, expect } from 'vitest';
import {
  NO_AI_ATTRIBUTION_RULE,
  COMMIT_MESSAGE_FORMAT_RULE,
  BRANCH_NAMING_RULE,
  NO_ROOT_MD_FILES_RULE,
  NO_BACKEND_SCRIPTS_RULE,
  DOCS_IN_SUBDIRS_RULE,
  MANDATORY_TEST_EXECUTION_RULE,
  MIN_COVERAGE_80_RULE,
  NO_SECRETS_IN_CODE_RULE,
  NO_PII_IN_LOGS_RULE,
  INPUT_VALIDATION_RULE,
  NO_CONSOLE_LOG_RULE,
  USE_SCHEMA_SYNC_RULE,
  getAllBuiltInRules,
} from '@/lib/services/built-in-rules';
import { RULE_IDS } from '@/lib/types/enforcement-rules';
import type { AgentAction, RuleContext } from '@/lib/types/enforcement-rules';

function makeAction(
  type: RuleContext,
  data: AgentAction['data']
): AgentAction {
  return {
    type,
    data,
    userId: 'user-1',
    projectId: 'project-1',
    timestamp: new Date(),
  };
}

describe('getAllBuiltInRules', () => {
  it('returns at least 10 rules (acceptance criteria)', () => {
    const rules = getAllBuiltInRules();
    expect(rules.length).toBeGreaterThanOrEqual(10);
  });

  it('every rule has a unique id', () => {
    const rules = getAllBuiltInRules();
    const ids = rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers git, file-placement, testing, security categories', () => {
    const categories = new Set(getAllBuiltInRules().map((r) => r.category));
    expect(categories).toContain('git');
    expect(categories).toContain('file-placement');
    expect(categories).toContain('testing');
    expect(categories).toContain('security');
  });

  it('every rule.check runs within the 50ms per-rule performance target', async () => {
    const action = makeAction('commit', {
      commitMessage: 'feat(auth): add login',
      files: ['app/x.ts'],
      testOutput: '95% coverage',
    });
    for (const rule of getAllBuiltInRules()) {
      const result = await rule.check(action);
      expect(result.duration).toBeLessThan(50);
    }
  });
});

describe('NO_AI_ATTRIBUTION_RULE', () => {
  it('blocks a commit message containing "Claude"', async () => {
    const action = makeAction('commit', {
      commitMessage: 'Add feature\n\nGenerated with Claude',
    });
    const result = await NO_AI_ATTRIBUTION_RULE.check(action);
    expect(result.passed).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations[0].level).toBe('error');
    expect(result.violations[0].autoFixable).toBe(true);
  });

  it('blocks Anthropic / ChatGPT / Copilot attribution', async () => {
    for (const term of ['Anthropic', 'ChatGPT', 'GitHub Copilot']) {
      const result = await NO_AI_ATTRIBUTION_RULE.check(
        makeAction('commit', { commitMessage: `fix: bug\n\n${term}` })
      );
      expect(result.passed).toBe(false);
    }
  });

  it('passes a clean commit message', async () => {
    const result = await NO_AI_ATTRIBUTION_RULE.check(
      makeAction('commit', { commitMessage: 'feat(auth): add login' })
    );
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('checks PR title and description too', async () => {
    const result = await NO_AI_ATTRIBUTION_RULE.check(
      makeAction('pr-create', {
        prTitle: 'Clean title',
        prDescription: 'Body\n\nCo-Authored-By: Claude',
      })
    );
    expect(result.passed).toBe(false);
  });

  it('autoFix strips attribution from commit message', async () => {
    const action = makeAction('commit', {
      commitMessage: 'Add feature\n\nCo-Authored-By: Claude',
    });
    const fixed = await NO_AI_ATTRIBUTION_RULE.autoFix!(action);
    expect(fixed.data.commitMessage).not.toContain('Claude');
  });

  it('autoFix rewrites "Generated with Claude" to AINative branding', async () => {
    const action = makeAction('commit', {
      commitMessage: 'Add feature\n\nGenerated with Claude',
    });
    const fixed = await NO_AI_ATTRIBUTION_RULE.autoFix!(action);
    expect(fixed.data.commitMessage).toContain('Built by AINative');
    expect(fixed.data.commitMessage).not.toContain('Claude');
  });

  it('autoFix does not mutate the original action', async () => {
    const original = 'Body\n\nGenerated with Claude';
    const action = makeAction('commit', { commitMessage: original });
    await NO_AI_ATTRIBUTION_RULE.autoFix!(action);
    expect(action.data.commitMessage).toBe(original);
  });
});

describe('COMMIT_MESSAGE_FORMAT_RULE', () => {
  it('warns on non-conventional commit message', async () => {
    const result = await COMMIT_MESSAGE_FORMAT_RULE.check(
      makeAction('commit', { commitMessage: 'Added some stuff' })
    );
    expect(result.passed).toBe(false);
    expect(result.violations[0].level).toBe('warning');
  });

  it('passes a conventional commit message', async () => {
    const result = await COMMIT_MESSAGE_FORMAT_RULE.check(
      makeAction('commit', {
        commitMessage: 'feat(auth): add user authentication',
      })
    );
    expect(result.passed).toBe(true);
  });

  it('warns when the first line exceeds 80 characters', async () => {
    const longDesc = 'x'.repeat(90);
    const result = await COMMIT_MESSAGE_FORMAT_RULE.check(
      makeAction('commit', { commitMessage: `feat(x): ${longDesc}` })
    );
    expect(result.passed).toBe(false);
  });
});

describe('BRANCH_NAMING_RULE', () => {
  it('warns on a branch without a valid prefix', async () => {
    const result = await BRANCH_NAMING_RULE.check(
      makeAction('branch-create', { branch: 'my-new-feature' })
    );
    expect(result.passed).toBe(false);
  });

  it('passes a prefixed branch', async () => {
    const result = await BRANCH_NAMING_RULE.check(
      makeAction('branch-create', { branch: 'feature/user-auth' })
    );
    expect(result.passed).toBe(true);
  });

  it('allows protected branches (main/master/develop)', async () => {
    for (const branch of ['main', 'master', 'develop']) {
      const result = await BRANCH_NAMING_RULE.check(
        makeAction('branch-create', { branch })
      );
      expect(result.passed).toBe(true);
    }
  });
});

describe('NO_ROOT_MD_FILES_RULE', () => {
  it('blocks a .md file in the project root', async () => {
    const result = await NO_ROOT_MD_FILES_RULE.check(
      makeAction('file-create', { filePath: 'SUMMARY.md' })
    );
    expect(result.passed).toBe(false);
    expect(result.violations[0].suggestion).toContain('docs/');
  });

  it('allows README.md and CODY.md in root', async () => {
    for (const filePath of ['README.md', 'CODY.md']) {
      const result = await NO_ROOT_MD_FILES_RULE.check(
        makeAction('file-create', { filePath })
      );
      expect(result.passed).toBe(true);
    }
  });

  it('allows .md files inside docs/', async () => {
    const result = await NO_ROOT_MD_FILES_RULE.check(
      makeAction('file-create', { filePath: 'docs/guides/setup.md' })
    );
    expect(result.passed).toBe(true);
  });
});

describe('NO_BACKEND_SCRIPTS_RULE', () => {
  it('blocks a .sh script in backend/', async () => {
    const result = await NO_BACKEND_SCRIPTS_RULE.check(
      makeAction('file-create', { filePath: 'backend/deploy.sh' })
    );
    expect(result.passed).toBe(false);
  });

  it('allows backend/start.sh', async () => {
    const result = await NO_BACKEND_SCRIPTS_RULE.check(
      makeAction('file-create', { filePath: 'backend/start.sh' })
    );
    expect(result.passed).toBe(true);
  });

  it('allows scripts in scripts/', async () => {
    const result = await NO_BACKEND_SCRIPTS_RULE.check(
      makeAction('file-create', { filePath: 'scripts/deploy/backend.sh' })
    );
    expect(result.passed).toBe(true);
  });
});

describe('DOCS_IN_SUBDIRS_RULE', () => {
  it('warns on a .md file directly in docs/', async () => {
    const result = await DOCS_IN_SUBDIRS_RULE.check(
      makeAction('file-create', { filePath: 'docs/API.md' })
    );
    expect(result.passed).toBe(false);
    expect(result.violations[0].level).toBe('warning');
  });

  it('passes docs in a subdirectory', async () => {
    const result = await DOCS_IN_SUBDIRS_RULE.check(
      makeAction('file-create', { filePath: 'docs/api/endpoints.md' })
    );
    expect(result.passed).toBe(true);
  });
});

describe('MANDATORY_TEST_EXECUTION_RULE', () => {
  it('blocks a commit with code changes but no test output', async () => {
    const result = await MANDATORY_TEST_EXECUTION_RULE.check(
      makeAction('commit', { files: ['app/feature.ts'] })
    );
    expect(result.passed).toBe(false);
    expect(result.violations[0].level).toBe('error');
  });

  it('passes when test output is included', async () => {
    const result = await MANDATORY_TEST_EXECUTION_RULE.check(
      makeAction('commit', {
        files: ['app/feature.ts'],
        testOutput: 'All tests passed',
      })
    );
    expect(result.passed).toBe(true);
  });

  it('passes when only test files changed', async () => {
    const result = await MANDATORY_TEST_EXECUTION_RULE.check(
      makeAction('commit', { files: ['app/feature.test.ts'] })
    );
    expect(result.passed).toBe(true);
  });
});

describe('MIN_COVERAGE_80_RULE', () => {
  it('blocks when coverage is below 80%', async () => {
    const result = await MIN_COVERAGE_80_RULE.check(
      makeAction('commit', { testOutput: 'Total: 65% coverage' })
    );
    expect(result.passed).toBe(false);
    expect(result.violations[0].message).toContain('65%');
  });

  it('passes when coverage is at or above 80%', async () => {
    const result = await MIN_COVERAGE_80_RULE.check(
      makeAction('commit', { testOutput: 'Total: 85% coverage' })
    );
    expect(result.passed).toBe(true);
  });

  it('passes when no coverage number is present', async () => {
    const result = await MIN_COVERAGE_80_RULE.check(
      makeAction('commit', { testOutput: 'tests passed' })
    );
    expect(result.passed).toBe(true);
  });
});

describe('NO_SECRETS_IN_CODE_RULE', () => {
  it('detects a Stripe live key', async () => {
    const result = await NO_SECRETS_IN_CODE_RULE.check(
      makeAction('file-edit', {
        filePath: 'lib/pay.ts',
        fileContent: 'const k = "sk_live_' + 'a'.repeat(30) + '"',
      })
    );
    expect(result.passed).toBe(false);
    expect(result.violations[0].level).toBe('error');
  });

  it('detects a hardcoded API key assignment', async () => {
    const result = await NO_SECRETS_IN_CODE_RULE.check(
      makeAction('file-edit', {
        filePath: 'lib/x.ts',
        fileContent: 'const API_KEY = "abcdefghij1234567890zzzz"',
      })
    );
    expect(result.passed).toBe(false);
  });

  it('skips .env.example files', async () => {
    const result = await NO_SECRETS_IN_CODE_RULE.check(
      makeAction('file-edit', {
        filePath: '.env.example',
        fileContent: 'API_KEY="abcdefghij1234567890zzzz"',
      })
    );
    expect(result.passed).toBe(true);
  });

  it('passes clean code using process.env', async () => {
    const result = await NO_SECRETS_IN_CODE_RULE.check(
      makeAction('file-edit', {
        filePath: 'lib/x.ts',
        fileContent: 'const apiKey = process.env.STRIPE_API_KEY',
      })
    );
    expect(result.passed).toBe(true);
  });
});

describe('NO_PII_IN_LOGS_RULE', () => {
  it('detects PII in a console.log', async () => {
    const result = await NO_PII_IN_LOGS_RULE.check(
      makeAction('file-edit', {
        filePath: 'lib/auth.ts',
        fileContent: 'console.log("pw", user.password)',
      })
    );
    expect(result.passed).toBe(false);
  });

  it('passes safe structured logging', async () => {
    const result = await NO_PII_IN_LOGS_RULE.check(
      makeAction('file-edit', {
        filePath: 'lib/auth.ts',
        fileContent: 'logger.info({ userId: user.id })',
      })
    );
    expect(result.passed).toBe(true);
  });
});

describe('INPUT_VALIDATION_RULE', () => {
  it('warns on an API route using req.body without validation', async () => {
    const result = await INPUT_VALIDATION_RULE.check(
      makeAction('file-edit', {
        filePath: 'app/api/users/route.ts',
        fileContent: 'const { email } = req.body',
      })
    );
    expect(result.passed).toBe(false);
    expect(result.violations[0].level).toBe('warning');
  });

  it('passes when validation is present', async () => {
    const result = await INPUT_VALIDATION_RULE.check(
      makeAction('file-edit', {
        filePath: 'app/api/users/route.ts',
        fileContent: 'const { email } = schema.parse(req.body)',
      })
    );
    expect(result.passed).toBe(true);
  });

  it('ignores non-API files', async () => {
    const result = await INPUT_VALIDATION_RULE.check(
      makeAction('file-edit', {
        filePath: 'lib/util.ts',
        fileContent: 'const x = req.body',
      })
    );
    expect(result.passed).toBe(true);
  });
});

describe('NO_CONSOLE_LOG_RULE', () => {
  it('warns on console.log in production code', async () => {
    const result = await NO_CONSOLE_LOG_RULE.check(
      makeAction('file-edit', {
        filePath: 'lib/x.ts',
        fileContent: 'console.log("hi")',
      })
    );
    expect(result.passed).toBe(false);
    expect(result.violations[0].autoFixable).toBe(true);
  });

  it('skips test files', async () => {
    const result = await NO_CONSOLE_LOG_RULE.check(
      makeAction('file-edit', {
        filePath: 'lib/x.test.ts',
        fileContent: 'console.log("hi")',
      })
    );
    expect(result.passed).toBe(true);
  });

  it('autoFix replaces console.log with logger.info', async () => {
    const action = makeAction('file-edit', {
      filePath: 'lib/x.ts',
      fileContent: 'console.log("hi")',
    });
    const fixed = await NO_CONSOLE_LOG_RULE.autoFix!(action);
    expect(fixed.data.fileContent).toContain('logger.info(');
    expect(fixed.data.fileContent).not.toContain('console.log(');
    // original untouched
    expect(action.data.fileContent).toContain('console.log(');
  });
});

describe('USE_SCHEMA_SYNC_RULE', () => {
  it('blocks committing alembic migration files', async () => {
    const result = await USE_SCHEMA_SYNC_RULE.check(
      makeAction('commit', {
        files: ['backend/alembic/versions/abc_add_table.py'],
        commitMessage: 'chore: migration',
      })
    );
    expect(result.passed).toBe(false);
  });

  it('blocks commit messages mentioning direct alembic commands', async () => {
    const result = await USE_SCHEMA_SYNC_RULE.check(
      makeAction('commit', {
        files: [],
        commitMessage: 'ran alembic upgrade head',
      })
    );
    expect(result.passed).toBe(false);
  });

  it('passes when schema sync script is used', async () => {
    const result = await USE_SCHEMA_SYNC_RULE.check(
      makeAction('commit', {
        files: ['scripts/sync-production-schema.py'],
        commitMessage: 'chore(db): sync schema',
      })
    );
    expect(result.passed).toBe(true);
  });
});

describe('rule ID constants alignment', () => {
  it('built-in rule ids match the RULE_IDS constants', () => {
    const ids = getAllBuiltInRules().map((r) => r.id);
    expect(ids).toContain(RULE_IDS.NO_AI_ATTRIBUTION);
    expect(ids).toContain(RULE_IDS.NO_SECRETS_IN_CODE);
    expect(ids).toContain(RULE_IDS.MANDATORY_TEST_EXECUTION);
    expect(ids).toContain(RULE_IDS.NO_ROOT_MD_FILES);
  });
});
