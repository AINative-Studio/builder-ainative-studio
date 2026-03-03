/**
 * Built-in Enforcement Rules
 *
 * This module defines all built-in rules that are automatically applied.
 * Each rule follows zero-tolerance enforcement patterns from .ainative/RULES.MD
 */

import {
  EnforcementRule,
  AgentAction,
  RuleCheckResult,
  RuleViolation,
  RULE_IDS,
} from '@/lib/types/enforcement-rules';

/**
 * Git Rule: No AI Attribution
 * Blocks third-party AI tool attribution in commits and PRs
 */
export const NO_AI_ATTRIBUTION_RULE: EnforcementRule = {
  id: RULE_IDS.NO_AI_ATTRIBUTION,
  name: 'No Third-Party AI Attribution',
  description:
    'Block third-party AI tool attribution (Claude, Anthropic, ChatGPT, Copilot) in commits and PRs. You can use AINative branding instead.',
  level: 'error',
  contexts: ['commit', 'pr-create'],
  enabled: true,
  category: 'git',
  tags: ['git', 'commit', 'attribution', 'zero-tolerance'],
  check: async (action: AgentAction): Promise<RuleCheckResult> => {
    const startTime = Date.now();
    const violations: RuleViolation[] = [];

    const text =
      action.data.commitMessage ||
      action.data.prDescription ||
      action.data.prTitle ||
      '';

    const forbiddenTerms = [
      { term: 'Claude', replacement: 'AINative' },
      { term: 'Anthropic', replacement: 'AINative' },
      { term: 'claude.com', replacement: 'ainative.com' },
      { term: 'ChatGPT', replacement: 'AINative' },
      { term: 'OpenAI', replacement: 'AINative' },
      { term: 'GitHub Copilot', replacement: 'AINative' },
      { term: 'Copilot', replacement: 'AINative' },
      { term: 'Co-Authored-By: Claude', replacement: '' },
      { term: 'Co-Authored-By: ChatGPT', replacement: '' },
      { term: 'Co-Authored-By: Copilot', replacement: '' },
      { term: 'Generated with Claude', replacement: 'Built by AINative' },
      { term: 'Generated with ChatGPT', replacement: 'Built by AINative' },
      { term: 'Powered by Claude', replacement: 'Powered by AINative Cloud' },
    ];

    for (const { term, replacement } of forbiddenTerms) {
      if (text.includes(term)) {
        violations.push({
          ruleId: RULE_IDS.NO_AI_ATTRIBUTION,
          level: 'error',
          message: `Forbidden third-party AI attribution detected: "${term}"`,
          details: `Found "${term}" in ${action.type}. This violates zero-tolerance attribution rules.`,
          autoFixable: true,
          suggestion: replacement
            ? `Replace with: "${replacement}"`
            : 'Remove this attribution',
          autoFix: async () => {
            // Auto-fix will strip the forbidden term
            if (action.data.commitMessage) {
              action.data.commitMessage = action.data.commitMessage.replace(
                new RegExp(term, 'gi'),
                replacement
              );
            }
            if (action.data.prDescription) {
              action.data.prDescription = action.data.prDescription.replace(
                new RegExp(term, 'gi'),
                replacement
              );
            }
            if (action.data.prTitle) {
              action.data.prTitle = action.data.prTitle.replace(
                new RegExp(term, 'gi'),
                replacement
              );
            }
          },
        });
      }
    }

    return {
      ruleId: RULE_IDS.NO_AI_ATTRIBUTION,
      passed: violations.length === 0,
      violations,
      duration: Date.now() - startTime,
    };
  },
  examples: [
    {
      invalid: 'Add user authentication\n\nGenerated with Claude Code',
      valid: 'Add user authentication\n\nBuilt by AINative',
      explanation:
        'Replace third-party AI attribution with AINative branding',
    },
  ],
};

/**
 * Git Rule: Commit Message Format
 * Enforces conventional commit format
 */
export const COMMIT_MESSAGE_FORMAT_RULE: EnforcementRule = {
  id: RULE_IDS.COMMIT_MESSAGE_FORMAT,
  name: 'Commit Message Format',
  description:
    'Enforce conventional commit format: type(scope): description',
  level: 'warning',
  contexts: ['commit'],
  enabled: true,
  category: 'git',
  tags: ['git', 'commit', 'format'],
  check: async (action: AgentAction): Promise<RuleCheckResult> => {
    const startTime = Date.now();
    const violations: RuleViolation[] = [];

    const message = action.data.commitMessage || '';
    const lines = message.split('\n');
    const firstLine = lines[0] || '';

    // Check conventional commit format: type(scope): description
    const conventionalCommitPattern =
      /^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)(\(.+\))?: .{1,80}$/;

    if (!conventionalCommitPattern.test(firstLine)) {
      violations.push({
        ruleId: RULE_IDS.COMMIT_MESSAGE_FORMAT,
        level: 'warning',
        message: 'Commit message does not follow conventional format',
        details: `Expected: type(scope): description\nGot: ${firstLine}`,
        autoFixable: false,
        suggestion: `Use format: type(scope): description

Valid types: feat, fix, docs, style, refactor, test, chore, perf, ci, build, revert

Examples:
- feat(auth): add user login
- fix(api): resolve null pointer
- docs(readme): update installation`,
      });
    }

    // Check message length
    if (firstLine.length > 80) {
      violations.push({
        ruleId: RULE_IDS.COMMIT_MESSAGE_FORMAT,
        level: 'warning',
        message: 'Commit message first line too long',
        details: `Maximum 80 characters, got ${firstLine.length}`,
        autoFixable: false,
        suggestion: 'Keep the first line under 80 characters',
      });
    }

    return {
      ruleId: RULE_IDS.COMMIT_MESSAGE_FORMAT,
      passed: violations.length === 0,
      violations,
      duration: Date.now() - startTime,
    };
  },
  examples: [
    {
      invalid: 'Added some stuff',
      valid: 'feat(auth): add user authentication',
      explanation: 'Follow conventional commit format with type and scope',
    },
  ],
};

/**
 * Git Rule: Branch Naming
 * Enforces branch naming convention
 */
export const BRANCH_NAMING_RULE: EnforcementRule = {
  id: RULE_IDS.BRANCH_NAMING,
  name: 'Branch Naming Convention',
  description:
    'Enforce branch naming: feature/*, bugfix/*, hotfix/*, chore/*',
  level: 'warning',
  contexts: ['branch-create'],
  enabled: true,
  category: 'git',
  tags: ['git', 'branch', 'naming'],
  check: async (action: AgentAction): Promise<RuleCheckResult> => {
    const startTime = Date.now();
    const violations: RuleViolation[] = [];

    const branchName = action.data.branch || '';

    // Valid branch prefixes
    const validPrefixes = [
      'feature/',
      'bugfix/',
      'hotfix/',
      'chore/',
      'docs/',
      'test/',
      'refactor/',
    ];

    const hasValidPrefix = validPrefixes.some((prefix) =>
      branchName.startsWith(prefix)
    );

    // Exclude main/master/develop
    const isProtectedBranch = ['main', 'master', 'develop'].includes(
      branchName
    );

    if (!hasValidPrefix && !isProtectedBranch) {
      violations.push({
        ruleId: RULE_IDS.BRANCH_NAMING,
        level: 'warning',
        message: 'Branch name does not follow naming convention',
        details: `Expected: prefix/description\nGot: ${branchName}`,
        autoFixable: false,
        suggestion: `Use one of these prefixes:
- feature/your-feature
- bugfix/issue-123
- hotfix/critical-fix
- chore/update-deps
- docs/api-docs
- test/unit-tests
- refactor/cleanup`,
      });
    }

    return {
      ruleId: RULE_IDS.BRANCH_NAMING,
      passed: violations.length === 0,
      violations,
      duration: Date.now() - startTime,
    };
  },
  examples: [
    {
      invalid: 'my-new-feature',
      valid: 'feature/user-authentication',
      explanation: 'Use prefix/ format for branch names',
    },
  ],
};

/**
 * File Placement Rule: No Root MD Files
 * Prevents documentation files in project root
 */
export const NO_ROOT_MD_FILES_RULE: EnforcementRule = {
  id: RULE_IDS.NO_ROOT_MD_FILES,
  name: 'No Root Markdown Files',
  description:
    'Documentation files must be in docs/ subdirectories, not in project root (except README.md, CODY.md)',
  level: 'error',
  contexts: ['file-create'],
  enabled: true,
  category: 'file-placement',
  tags: ['file-placement', 'documentation', 'zero-tolerance'],
  check: async (action: AgentAction): Promise<RuleCheckResult> => {
    const startTime = Date.now();
    const violations: RuleViolation[] = [];

    const filePath = action.data.filePath || '';
    const fileName = filePath.split('/').pop() || '';

    // Check if it's a .md file in root
    const isRootMdFile =
      filePath.endsWith('.md') &&
      !filePath.includes('/') &&
      fileName !== 'README.md' &&
      fileName !== 'CODY.md';

    if (isRootMdFile) {
      violations.push({
        ruleId: RULE_IDS.NO_ROOT_MD_FILES,
        level: 'error',
        message: `Documentation file "${fileName}" cannot be created in project root`,
        details:
          'All documentation must be in docs/ subdirectories for proper organization.',
        location: {
          file: filePath,
        },
        autoFixable: false,
        suggestion: `Move to appropriate docs/ subdirectory:
- Issues/Bugs → docs/issues/
- Testing → docs/testing/
- API docs → docs/api/
- Reports → docs/reports/
- Guides → docs/guides/`,
      });
    }

    return {
      ruleId: RULE_IDS.NO_ROOT_MD_FILES,
      passed: violations.length === 0,
      violations,
      duration: Date.now() - startTime,
    };
  },
  examples: [
    {
      invalid: 'SETUP_GUIDE.md',
      valid: 'docs/guides/SETUP_GUIDE.md',
      explanation: 'Place documentation in appropriate docs/ subdirectory',
    },
  ],
};

/**
 * File Placement Rule: No Backend Scripts
 * Prevents .sh scripts in backend directory
 */
export const NO_BACKEND_SCRIPTS_RULE: EnforcementRule = {
  id: RULE_IDS.NO_BACKEND_SCRIPTS,
  name: 'No Shell Scripts in Backend',
  description:
    'Shell scripts (.sh) must be in scripts/ folder, not backend/ (except start.sh)',
  level: 'error',
  contexts: ['file-create'],
  enabled: true,
  category: 'file-placement',
  tags: ['file-placement', 'scripts', 'zero-tolerance'],
  check: async (action: AgentAction): Promise<RuleCheckResult> => {
    const startTime = Date.now();
    const violations: RuleViolation[] = [];

    const filePath = action.data.filePath || '';
    const fileName = filePath.split('/').pop() || '';

    // Check if it's a .sh file in backend/
    const isBackendScript =
      filePath.endsWith('.sh') &&
      filePath.startsWith('backend/') &&
      fileName !== 'start.sh';

    if (isBackendScript) {
      violations.push({
        ruleId: RULE_IDS.NO_BACKEND_SCRIPTS,
        level: 'error',
        message: `Shell script "${fileName}" cannot be in backend/ directory`,
        details: 'All scripts must be in scripts/ folder for consistency.',
        location: {
          file: filePath,
        },
        autoFixable: false,
        suggestion: `Move to scripts/ folder:
- Backend scripts → scripts/backend/
- Database scripts → scripts/db/
- Deployment scripts → scripts/deploy/`,
      });
    }

    return {
      ruleId: RULE_IDS.NO_BACKEND_SCRIPTS,
      passed: violations.length === 0,
      violations,
      duration: Date.now() - startTime,
    };
  },
  examples: [
    {
      invalid: 'backend/deploy.sh',
      valid: 'scripts/deploy/backend.sh',
      explanation: 'Move shell scripts to scripts/ directory',
    },
  ],
};

/**
 * File Placement Rule: Docs in Subdirs
 * Ensures docs are properly organized
 */
export const DOCS_IN_SUBDIRS_RULE: EnforcementRule = {
  id: RULE_IDS.DOCS_IN_SUBDIRS,
  name: 'Documentation Must Be in Subdirectories',
  description: 'Documentation in docs/ must be in appropriate subdirectories',
  level: 'warning',
  contexts: ['file-create'],
  enabled: true,
  category: 'file-placement',
  tags: ['file-placement', 'documentation'],
  check: async (action: AgentAction): Promise<RuleCheckResult> => {
    const startTime = Date.now();
    const violations: RuleViolation[] = [];

    const filePath = action.data.filePath || '';

    // Check if it's a file directly in docs/ (not in a subdirectory)
    const isDocsRootFile =
      filePath.startsWith('docs/') &&
      filePath.split('/').length === 2 &&
      filePath.endsWith('.md');

    if (isDocsRootFile) {
      violations.push({
        ruleId: RULE_IDS.DOCS_IN_SUBDIRS,
        level: 'warning',
        message: 'Documentation file should be in a subdirectory',
        details: `File "${filePath}" is in docs/ root. Use subdirectories for better organization.`,
        location: {
          file: filePath,
        },
        autoFixable: false,
        suggestion: `Move to appropriate subdirectory:
- API documentation → docs/api/
- User guides → docs/guides/
- Development docs → docs/development/
- Testing docs → docs/testing/
- Architecture docs → docs/architecture/`,
      });
    }

    return {
      ruleId: RULE_IDS.DOCS_IN_SUBDIRS,
      passed: violations.length === 0,
      violations,
      duration: Date.now() - startTime,
    };
  },
  examples: [
    {
      invalid: 'docs/API.md',
      valid: 'docs/api/endpoints.md',
      explanation: 'Organize documentation in subdirectories',
    },
  ],
};

/**
 * Testing Rule: Mandatory Test Execution
 * Requires evidence of test execution
 */
export const MANDATORY_TEST_EXECUTION_RULE: EnforcementRule = {
  id: RULE_IDS.MANDATORY_TEST_EXECUTION,
  name: 'Mandatory Test Execution',
  description:
    'Tests must be actually run before commits and PRs, with proof of execution',
  level: 'error',
  contexts: ['commit', 'pr-create'],
  enabled: true,
  category: 'testing',
  tags: ['testing', 'tdd', 'zero-tolerance'],
  check: async (action: AgentAction): Promise<RuleCheckResult> => {
    const startTime = Date.now();
    const violations: RuleViolation[] = [];

    // Check if test output is included
    const hasTestOutput = Boolean(action.data.testOutput);
    const hasCodeChanges = action.data.files?.some(
      (f) =>
        (f.endsWith('.ts') ||
          f.endsWith('.tsx') ||
          f.endsWith('.js') ||
          f.endsWith('.jsx') ||
          f.endsWith('.py')) &&
        !f.includes('.test.') &&
        !f.includes('.spec.')
    );

    if (hasCodeChanges && !hasTestOutput) {
      violations.push({
        ruleId: RULE_IDS.MANDATORY_TEST_EXECUTION,
        level: 'error',
        message: 'No test execution evidence found',
        details:
          'Tests must be actually run and output included before commits/PRs',
        autoFixable: false,
        suggestion: `Run tests and include output:

Backend (Python):
  cd backend && pytest tests/ -v --cov

Frontend (TypeScript):
  npm test -- --coverage

Include the output in your commit message or PR description.`,
      });
    }

    return {
      ruleId: RULE_IDS.MANDATORY_TEST_EXECUTION,
      passed: violations.length === 0,
      violations,
      duration: Date.now() - startTime,
    };
  },
  examples: [
    {
      invalid: 'Commit with code changes but no test output',
      valid: 'Commit with test output showing all tests passed',
      explanation: 'Always run tests and include proof of execution',
    },
  ],
};

/**
 * Testing Rule: Minimum Coverage 80%
 * Enforces code coverage threshold
 */
export const MIN_COVERAGE_80_RULE: EnforcementRule = {
  id: RULE_IDS.MIN_COVERAGE_80,
  name: 'Minimum 80% Code Coverage',
  description: 'Code coverage must be at least 80%',
  level: 'error',
  contexts: ['commit', 'pr-create'],
  enabled: true,
  category: 'testing',
  tags: ['testing', 'coverage', 'quality'],
  check: async (action: AgentAction): Promise<RuleCheckResult> => {
    const startTime = Date.now();
    const violations: RuleViolation[] = [];

    const testOutput = action.data.testOutput || '';

    // Extract coverage percentage from test output
    const coverageMatch = testOutput.match(/(\d+)%\s+coverage/i);
    const coverage = coverageMatch ? parseInt(coverageMatch[1]) : null;

    if (coverage !== null && coverage < 80) {
      violations.push({
        ruleId: RULE_IDS.MIN_COVERAGE_80,
        level: 'error',
        message: `Code coverage ${coverage}% is below minimum 80%`,
        details: `Need ${80 - coverage}% more coverage`,
        autoFixable: false,
        suggestion: `Increase test coverage to at least 80%:

1. Identify uncovered code:
   - Run coverage report with --coverage
   - Check coverage/index.html

2. Write missing tests:
   - Add unit tests for uncovered functions
   - Add integration tests for workflows
   - Add edge case tests

3. Current coverage: ${coverage}%
   Target coverage: 80%
   Gap: ${80 - coverage}%`,
      });
    }

    return {
      ruleId: RULE_IDS.MIN_COVERAGE_80,
      passed: violations.length === 0,
      violations,
      duration: Date.now() - startTime,
    };
  },
  examples: [
    {
      invalid: 'Test coverage: 65%',
      valid: 'Test coverage: 85%',
      explanation: 'Maintain at least 80% code coverage',
    },
  ],
};

/**
 * Security Rule: No Secrets in Code
 * Detects hardcoded secrets
 */
export const NO_SECRETS_IN_CODE_RULE: EnforcementRule = {
  id: RULE_IDS.NO_SECRETS_IN_CODE,
  name: 'No Secrets in Code',
  description: 'Prevent committing API keys, passwords, tokens',
  level: 'error',
  contexts: ['commit', 'file-create', 'file-edit'],
  enabled: true,
  category: 'security',
  tags: ['security', 'secrets', 'zero-tolerance'],
  check: async (action: AgentAction): Promise<RuleCheckResult> => {
    const startTime = Date.now();
    const violations: RuleViolation[] = [];

    const content = action.data.fileContent || '';
    const filePath = action.data.filePath || '';

    // Skip if it's an env example file
    if (filePath.includes('.env.example') || filePath.includes('.env.template')) {
      return {
        ruleId: RULE_IDS.NO_SECRETS_IN_CODE,
        passed: true,
        violations: [],
        duration: Date.now() - startTime,
      };
    }

    // Common secret patterns
    const secretPatterns = [
      { pattern: /api[_-]?key\s*=\s*['"][^'"]{20,}['"]/i, name: 'API Key' },
      { pattern: /password\s*=\s*['"][^'"]+['"]/i, name: 'Password' },
      { pattern: /sk_live_[a-zA-Z0-9]{24,}/, name: 'Stripe Live Key' },
      { pattern: /ghp_[a-zA-Z0-9]{36}/, name: 'GitHub Token' },
      { pattern: /AKIA[0-9A-Z]{16}/, name: 'AWS Access Key' },
      { pattern: /AIza[0-9A-Za-z-_]{35}/, name: 'Google API Key' },
      { pattern: /sk-[a-zA-Z0-9]{48}/, name: 'OpenAI API Key' },
      {
        pattern: /postgres:\/\/[^:]+:[^@]{8,}@/,
        name: 'Database Connection String with Password',
      },
    ];

    for (const { pattern, name } of secretPatterns) {
      if (pattern.test(content)) {
        violations.push({
          ruleId: RULE_IDS.NO_SECRETS_IN_CODE,
          level: 'error',
          message: `Potential ${name} detected in code`,
          details: 'Never commit secrets to version control',
          location: {
            file: filePath,
          },
          autoFixable: false,
          suggestion: `Use environment variables instead:

1. Add to .env file:
   YOUR_API_KEY=your_secret_here

2. Reference in code:
   const apiKey = process.env.YOUR_API_KEY

3. Add .env to .gitignore

4. Document required env vars in README.md`,
        });
      }
    }

    return {
      ruleId: RULE_IDS.NO_SECRETS_IN_CODE,
      passed: violations.length === 0,
      violations,
      duration: Date.now() - startTime,
    };
  },
  examples: [
    {
      invalid: 'const apiKey = "sk_live_abc123..."',
      valid: 'const apiKey = process.env.STRIPE_API_KEY',
      explanation: 'Use environment variables for secrets',
    },
  ],
};

/**
 * Security Rule: No PII in Logs
 * Prevents logging sensitive user data
 */
export const NO_PII_IN_LOGS_RULE: EnforcementRule = {
  id: RULE_IDS.NO_PII_IN_LOGS,
  name: 'No PII in Logs',
  description: 'Prevent logging personally identifiable information',
  level: 'error',
  contexts: ['file-create', 'file-edit'],
  enabled: true,
  category: 'security',
  tags: ['security', 'privacy', 'pii'],
  check: async (action: AgentAction): Promise<RuleCheckResult> => {
    const startTime = Date.now();
    const violations: RuleViolation[] = [];

    const content = action.data.fileContent || '';
    const filePath = action.data.filePath || '';

    // PII patterns in log statements
    const piiPatterns = [
      {
        pattern: /console\.log\([^)]*\b(password|ssn|creditCard|email|phone)\b/i,
        name: 'PII in console.log',
      },
      {
        pattern: /logger\.(info|debug|warn)\([^)]*\b(password|ssn|creditCard)\b/i,
        name: 'PII in logger',
      },
    ];

    for (const { pattern, name } of piiPatterns) {
      if (pattern.test(content)) {
        violations.push({
          ruleId: RULE_IDS.NO_PII_IN_LOGS,
          level: 'error',
          message: `${name} detected`,
          details:
            'Logging PII violates privacy regulations (GDPR, CCPA). Never log passwords, SSNs, credit cards, or other sensitive data.',
          location: {
            file: filePath,
          },
          autoFixable: false,
          suggestion: `Remove PII from logs:

1. Redact sensitive fields:
   logger.info({ userId: user.id, email: '[REDACTED]' })

2. Use sanitized data structures:
   const sanitized = sanitizeUser(user)
   logger.info(sanitized)

3. Log only necessary fields:
   logger.info({ action: 'login', userId: user.id })`,
        });
      }
    }

    return {
      ruleId: RULE_IDS.NO_PII_IN_LOGS,
      passed: violations.length === 0,
      violations,
      duration: Date.now() - startTime,
    };
  },
  examples: [
    {
      invalid: 'console.log("User password:", user.password)',
      valid: 'logger.info({ action: "login", userId: user.id })',
      explanation: 'Never log passwords or sensitive data',
    },
  ],
};

/**
 * Security Rule: Input Validation
 * Ensures user input is validated
 */
export const INPUT_VALIDATION_RULE: EnforcementRule = {
  id: RULE_IDS.INPUT_VALIDATION,
  name: 'Input Validation Required',
  description: 'User input must be validated before processing',
  level: 'warning',
  contexts: ['file-create', 'file-edit'],
  enabled: true,
  category: 'security',
  tags: ['security', 'validation', 'input'],
  check: async (action: AgentAction): Promise<RuleCheckResult> => {
    const startTime = Date.now();
    const violations: RuleViolation[] = [];

    const content = action.data.fileContent || '';
    const filePath = action.data.filePath || '';

    // Check for API route handlers without validation
    const isApiRoute = filePath.includes('/api/') || filePath.includes('/routes/');

    if (isApiRoute) {
      // Check for request.body usage without validation
      const hasRequestBody = /request\.body|req\.body/i.test(content);
      const hasValidation = /zod|yup|joi|validateSchema|parse\(/i.test(content);

      if (hasRequestBody && !hasValidation) {
        violations.push({
          ruleId: RULE_IDS.INPUT_VALIDATION,
          level: 'warning',
          message: 'API route uses request body without validation',
          details: 'Always validate user input to prevent injection attacks',
          location: {
            file: filePath,
          },
          autoFixable: false,
          suggestion: `Add input validation using Zod:

import { z } from 'zod';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const validated = schema.parse(request.body);`,
        });
      }
    }

    return {
      ruleId: RULE_IDS.INPUT_VALIDATION,
      passed: violations.length === 0,
      violations,
      duration: Date.now() - startTime,
    };
  },
  examples: [
    {
      invalid: 'const { email } = request.body',
      valid: 'const { email } = schema.parse(request.body)',
      explanation: 'Validate all user input with a schema validator',
    },
  ],
};

/**
 * Code Quality Rule: No Console Log
 * Prevents console.log in production code
 */
export const NO_CONSOLE_LOG_RULE: EnforcementRule = {
  id: RULE_IDS.NO_CONSOLE_LOG,
  name: 'No Console.log in Production',
  description: 'Use proper logger instead of console.log',
  level: 'warning',
  contexts: ['file-create', 'file-edit'],
  enabled: true,
  category: 'code-quality',
  tags: ['code-quality', 'logging'],
  check: async (action: AgentAction): Promise<RuleCheckResult> => {
    const startTime = Date.now();
    const violations: RuleViolation[] = [];

    const content = action.data.fileContent || '';
    const filePath = action.data.filePath || '';

    // Skip test files
    if (filePath.includes('.test.') || filePath.includes('.spec.')) {
      return {
        ruleId: RULE_IDS.NO_CONSOLE_LOG,
        passed: true,
        violations: [],
        duration: Date.now() - startTime,
      };
    }

    // Check for console.log
    const consoleLogPattern = /console\.log\(/g;
    const matches = content.match(consoleLogPattern);

    if (matches) {
      violations.push({
        ruleId: RULE_IDS.NO_CONSOLE_LOG,
        level: 'warning',
        message: `Found ${matches.length} console.log statement(s)`,
        details: 'Use a proper logger (pino, winston) instead of console.log',
        location: {
          file: filePath,
        },
        autoFixable: true,
        suggestion: `Replace with proper logger:

import logger from '@/lib/logger';

// Instead of:
console.log('User logged in', userId);

// Use:
logger.info({ userId }, 'User logged in');`,
        autoFix: async () => {
          // Auto-fix would replace console.log with logger
          action.data.fileContent = content.replace(
            /console\.log\(/g,
            'logger.info('
          );
        },
      });
    }

    return {
      ruleId: RULE_IDS.NO_CONSOLE_LOG,
      passed: violations.length === 0,
      violations,
      duration: Date.now() - startTime,
    };
  },
  examples: [
    {
      invalid: 'console.log("Debug info:", data)',
      valid: 'logger.debug({ data }, "Debug info")',
      explanation: 'Use structured logging with proper logger',
    },
  ],
};

/**
 * Database Rule: Use Schema Sync
 * Enforces schema sync over direct migrations
 */
export const USE_SCHEMA_SYNC_RULE: EnforcementRule = {
  id: RULE_IDS.USE_SCHEMA_SYNC,
  name: 'Use Schema Sync Script',
  description: 'Use scripts/sync-production-schema.py instead of direct Alembic migrations',
  level: 'error',
  contexts: ['commit'],
  enabled: true,
  category: 'database',
  tags: ['database', 'schema', 'migration'],
  check: async (action: AgentAction): Promise<RuleCheckResult> => {
    const startTime = Date.now();
    const violations: RuleViolation[] = [];

    const files = action.data.files || [];
    const commitMessage = action.data.commitMessage || '';

    // Check if Alembic migration files are being committed
    const hasAlembicMigrations = files.some(f => f.includes('alembic/versions/'));

    // Check if commit message mentions running migrations directly
    const mentionsDirectMigration = /alembic upgrade|alembic revision/i.test(commitMessage);

    if (hasAlembicMigrations || mentionsDirectMigration) {
      violations.push({
        ruleId: RULE_IDS.USE_SCHEMA_SYNC,
        level: 'error',
        message: 'Direct Alembic migrations detected',
        details: 'Use scripts/sync-production-schema.py instead of direct Alembic migrations in production',
        autoFixable: false,
        suggestion: `Use the idempotent schema sync script:

1. First run with --dry-run:
   python scripts/sync-production-schema.py --dry-run

2. Review the changes

3. Apply the changes:
   python scripts/sync-production-schema.py

This ensures idempotent, safe schema changes.`,
      });
    }

    return {
      ruleId: RULE_IDS.USE_SCHEMA_SYNC,
      passed: violations.length === 0,
      violations,
      duration: Date.now() - startTime,
    };
  },
  examples: [
    {
      invalid: 'alembic upgrade head',
      valid: 'python scripts/sync-production-schema.py',
      explanation: 'Use idempotent schema sync script for production',
    },
  ],
};

/**
 * Get all built-in rules
 */
export function getAllBuiltInRules(): EnforcementRule[] {
  return [
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
  ];
}
