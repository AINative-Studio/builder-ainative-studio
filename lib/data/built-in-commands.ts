/**
 * Built-in Agent Commands
 *
 * Pre-configured commands for common development workflows
 *
 * Commands:
 * 1. Create Pull Request
 * 2. Run Tests with Evidence
 * 3. Deploy to Staging
 * 4. Generate Documentation
 * 5. Code Review Checklist
 */

import type { AgentCommand } from '../types/agent-commands';

export const BUILT_IN_COMMANDS: Omit<AgentCommand, 'metadata'>[] = [
  {
    // 1. Create Pull Request
    template: `Create a pull request for the current changes with the following details:

**Title**: {{prTitle}}

**Description**:
{{prDescription}}

**Target Branch**: {{targetBranch}}

Please:
1. Review all uncommitted changes in the current branch
2. Create a comprehensive PR description including:
   - Summary of changes
   - Testing performed
   - Screenshots/evidence if UI changes
   - Related issues: {{relatedIssues}}
3. {{includeChangeLog ? "Generate a changelog entry" : "Skip changelog"}}
4. Set appropriate labels and reviewers
5. {{autoDeploy ? "Enable auto-deploy to staging on approval" : "Disable auto-deploy"}}

Follow best practices for PR creation and ensure all CI checks will pass.`,

    variables: [
      {
        name: 'prTitle',
        label: 'PR Title',
        description: 'Clear, descriptive title for the pull request',
        type: 'text',
        required: true,
        placeholder: 'feat: Add user authentication system',
        validation: '^.{10,}$',
        validationMessage: 'PR title must be at least 10 characters',
      },
      {
        name: 'prDescription',
        label: 'PR Description',
        description: 'Detailed description of changes',
        type: 'text',
        required: true,
        placeholder: 'Implemented JWT-based authentication with email verification...',
      },
      {
        name: 'targetBranch',
        label: 'Target Branch',
        type: 'select',
        required: true,
        defaultValue: 'main',
        options: [
          { label: 'main', value: 'main', description: 'Production branch' },
          { label: 'develop', value: 'develop', description: 'Development branch' },
          { label: 'staging', value: 'staging', description: 'Staging branch' },
        ],
      },
      {
        name: 'relatedIssues',
        label: 'Related Issues',
        description: 'Issue numbers (e.g., #123, #456)',
        type: 'text',
        required: false,
        placeholder: '#123',
      },
      {
        name: 'includeChangeLog',
        label: 'Include Changelog Entry',
        type: 'boolean',
        required: false,
        defaultValue: true,
      },
      {
        name: 'autoDeploy',
        label: 'Auto-deploy to Staging',
        description: 'Automatically deploy to staging when PR is approved',
        type: 'boolean',
        required: false,
        defaultValue: false,
      },
    ],

    requiredSkills: ['git-workflow', 'pr-best-practices'],

    preConditions: [
      {
        id: 'git-uncommitted',
        type: 'git_status',
        description: 'Git working directory has changes',
        config: {
          gitStatus: 'dirty',
        },
        blocking: true,
        errorMessage: 'No uncommitted changes found. Make some changes before creating a PR.',
      },
      {
        id: 'git-remote',
        type: 'custom',
        description: 'Git remote is configured',
        config: {
          expression: 'hasGitRemote()',
        },
        blocking: true,
        errorMessage: 'No git remote configured. Please set up a remote repository.',
      },
    ],

    checkpoints: [
      {
        id: 'review-changes',
        title: 'Review Changes',
        description: 'Analyze all file changes and generate summary',
        order: 1,
        type: 'action',
      },
      {
        id: 'run-tests',
        title: 'Run Tests',
        description: 'Execute test suite to ensure nothing is broken',
        order: 2,
        type: 'validation',
      },
      {
        id: 'create-pr-body',
        title: 'Generate PR Body',
        description: 'Create comprehensive PR description with evidence',
        order: 3,
        type: 'action',
      },
      {
        id: 'create-pr',
        title: 'Create Pull Request',
        description: 'Submit PR to GitHub/GitLab',
        order: 4,
        type: 'action',
      },
      {
        id: 'verify-pr',
        title: 'Verify PR Creation',
        description: 'Confirm PR was created successfully',
        order: 5,
        type: 'evidence',
        evidenceTypes: ['link', 'screenshot'],
      },
    ],

    output: {
      type: 'pr',
      config: {
        platform: 'github',
      },
      successCriteria: [
        'PR created successfully',
        'All CI checks initiated',
        'Reviewers assigned',
      ],
    },

    validationRules: ['git/no-ai-attribution', 'pr/require-description'],

    estimatedTokenCost: 3000,
    version: '1.0.0',
  },

  {
    // 2. Run Tests with Evidence
    template: `Run comprehensive test suite and collect evidence:

**Test Scope**: {{testScope}}
**Coverage Threshold**: {{coverageThreshold}}%
**Test Framework**: {{testFramework}}

Please:
1. Run {{testScope}} tests using {{testFramework}}
2. Collect test results and coverage reports
3. {{captureFailures ? "Capture detailed failure logs for any failing tests" : "Only report pass/fail status"}}
4. {{generateReport ? "Generate HTML test report" : "Skip HTML report generation"}}
5. Ensure coverage meets {{coverageThreshold}}% threshold
6. Attach evidence of test execution

Provide a comprehensive summary of test results.`,

    variables: [
      {
        name: 'testScope',
        label: 'Test Scope',
        type: 'select',
        required: true,
        defaultValue: 'all',
        options: [
          { label: 'All Tests', value: 'all', description: 'Run entire test suite' },
          { label: 'Unit Tests Only', value: 'unit', description: 'Run only unit tests' },
          { label: 'Integration Tests', value: 'integration', description: 'Run integration tests' },
          { label: 'E2E Tests', value: 'e2e', description: 'Run end-to-end tests' },
        ],
      },
      {
        name: 'testFramework',
        label: 'Test Framework',
        type: 'select',
        required: true,
        defaultValue: 'vitest',
        options: [
          { label: 'Vitest', value: 'vitest' },
          { label: 'Jest', value: 'jest' },
          { label: 'Playwright', value: 'playwright' },
          { label: 'Cypress', value: 'cypress' },
        ],
      },
      {
        name: 'coverageThreshold',
        label: 'Coverage Threshold (%)',
        type: 'number',
        required: true,
        defaultValue: 80,
      },
      {
        name: 'captureFailures',
        label: 'Capture Detailed Failure Logs',
        type: 'boolean',
        required: false,
        defaultValue: true,
      },
      {
        name: 'generateReport',
        label: 'Generate HTML Report',
        type: 'boolean',
        required: false,
        defaultValue: true,
      },
    ],

    requiredSkills: ['mandatory-tdd', 'testing-best-practices'],

    preConditions: [
      {
        id: 'test-files-exist',
        type: 'file_exists',
        description: 'Test files exist in project',
        config: {
          filePath: '**/*.test.{ts,tsx,js,jsx}',
        },
        blocking: true,
        errorMessage: 'No test files found. Please create tests first.',
      },
    ],

    checkpoints: [
      {
        id: 'setup-test-env',
        title: 'Setup Test Environment',
        description: 'Configure test environment and dependencies',
        order: 1,
        type: 'action',
      },
      {
        id: 'run-tests',
        title: 'Execute Tests',
        description: 'Run test suite and collect results',
        order: 2,
        type: 'action',
      },
      {
        id: 'check-coverage',
        title: 'Validate Coverage',
        description: 'Ensure code coverage meets threshold',
        order: 3,
        type: 'validation',
      },
      {
        id: 'collect-evidence',
        title: 'Collect Evidence',
        description: 'Capture test reports and screenshots',
        order: 4,
        type: 'evidence',
        evidenceTypes: ['file', 'log', 'screenshot'],
      },
      {
        id: 'generate-summary',
        title: 'Generate Summary',
        description: 'Create test execution summary report',
        order: 5,
        type: 'action',
      },
    ],

    output: {
      type: 'report',
      config: {
        format: 'html',
      },
      successCriteria: [
        'All tests passed',
        'Coverage threshold met',
        'Evidence collected',
      ],
    },

    validationRules: ['mandatory-tdd/min-coverage'],

    estimatedTokenCost: 2500,
    version: '1.0.0',
  },

  {
    // 3. Deploy to Staging
    template: `Deploy application to staging environment:

**Platform**: {{platform}}
**Environment**: {{environment}}

Please:
1. Build the application for {{environment}} environment
2. Run pre-deployment checks and validations
3. {{runMigrations ? "Run database migrations" : "Skip database migrations"}}
4. Deploy to {{platform}}
5. {{runSmokeTests ? "Run smoke tests after deployment" : "Skip smoke tests"}}
6. {{notifyTeam ? "Send deployment notification to team" : "Skip team notification"}}
7. Verify deployment health and provide deployment URL

Monitor the deployment and report any issues.`,

    variables: [
      {
        name: 'platform',
        label: 'Deployment Platform',
        type: 'select',
        required: true,
        defaultValue: 'vercel',
        options: [
          { label: 'Vercel', value: 'vercel', description: 'Deploy to Vercel' },
          { label: 'Netlify', value: 'netlify', description: 'Deploy to Netlify' },
          { label: 'Railway', value: 'railway', description: 'Deploy to Railway' },
          { label: 'AINative Cloud', value: 'ainative-cloud', description: 'Deploy to AINative Cloud' },
        ],
      },
      {
        name: 'environment',
        label: 'Environment',
        type: 'select',
        required: true,
        defaultValue: 'staging',
        options: [
          { label: 'Staging', value: 'staging' },
          { label: 'Preview', value: 'preview' },
          { label: 'Production', value: 'production' },
        ],
      },
      {
        name: 'runMigrations',
        label: 'Run Database Migrations',
        type: 'boolean',
        required: false,
        defaultValue: true,
      },
      {
        name: 'runSmokeTests',
        label: 'Run Smoke Tests',
        description: 'Run basic health checks after deployment',
        type: 'boolean',
        required: false,
        defaultValue: true,
      },
      {
        name: 'notifyTeam',
        label: 'Notify Team',
        description: 'Send deployment notification via Slack/email',
        type: 'boolean',
        required: false,
        defaultValue: false,
      },
    ],

    requiredSkills: ['deployment-best-practices', 'ci-cd-compliance'],

    preConditions: [
      {
        id: 'env-credentials',
        type: 'env_var',
        description: 'Deployment credentials configured',
        config: {
          envVar: 'DEPLOYMENT_TOKEN',
        },
        blocking: true,
        errorMessage: 'Deployment credentials not found. Please configure deployment token.',
      },
      {
        id: 'git-clean',
        type: 'git_status',
        description: 'No uncommitted changes',
        config: {
          gitStatus: 'clean',
        },
        blocking: false,
        errorMessage: 'Warning: You have uncommitted changes.',
      },
    ],

    checkpoints: [
      {
        id: 'pre-deploy-checks',
        title: 'Pre-deployment Checks',
        description: 'Validate environment and credentials',
        order: 1,
        type: 'validation',
      },
      {
        id: 'build-application',
        title: 'Build Application',
        description: 'Compile and bundle application',
        order: 2,
        type: 'action',
      },
      {
        id: 'run-migrations',
        title: 'Database Migrations',
        description: 'Run database schema migrations',
        order: 3,
        type: 'action',
      },
      {
        id: 'deploy',
        title: 'Deploy to Platform',
        description: 'Upload and deploy application',
        order: 4,
        type: 'action',
      },
      {
        id: 'health-check',
        title: 'Health Check',
        description: 'Verify deployment is healthy',
        order: 5,
        type: 'validation',
      },
      {
        id: 'smoke-tests',
        title: 'Smoke Tests',
        description: 'Run basic functional tests',
        order: 6,
        type: 'validation',
      },
      {
        id: 'collect-deployment-info',
        title: 'Deployment Complete',
        description: 'Collect deployment URL and evidence',
        order: 7,
        type: 'evidence',
        evidenceTypes: ['link', 'screenshot'],
      },
    ],

    output: {
      type: 'deployment',
      config: {
        platform: '{{platform}}',
      },
      successCriteria: [
        'Deployment successful',
        'Health checks passed',
        'Deployment URL accessible',
      ],
    },

    validationRules: ['ci-cd/staging-approval'],

    estimatedTokenCost: 3500,
    version: '1.0.0',
  },

  {
    // 4. Generate Documentation
    template: `Generate comprehensive documentation for the project:

**Documentation Type**: {{docType}}
**Format**: {{format}}
**Scope**: {{scope}}

Please:
1. Analyze {{scope}} to understand structure and functionality
2. Generate {{docType}} documentation in {{format}} format
3. {{includeExamples ? "Include code examples and usage snippets" : "Skip code examples"}}
4. {{includeApiDocs ? "Generate API reference documentation" : "Skip API docs"}}
5. {{includeDiagrams ? "Create architecture and flow diagrams" : "Skip diagrams"}}
6. {{autoPublish ? "Publish documentation to docs site" : "Save locally only"}}
7. Follow documentation best practices and style guide

Create clear, comprehensive, and maintainable documentation.`,

    variables: [
      {
        name: 'docType',
        label: 'Documentation Type',
        type: 'select',
        required: true,
        options: [
          { label: 'README', value: 'readme', description: 'Project README file' },
          { label: 'API Documentation', value: 'api', description: 'API reference docs' },
          { label: 'User Guide', value: 'user-guide', description: 'End-user documentation' },
          { label: 'Developer Guide', value: 'dev-guide', description: 'Developer documentation' },
          { label: 'Architecture Docs', value: 'architecture', description: 'System architecture' },
        ],
      },
      {
        name: 'format',
        label: 'Format',
        type: 'select',
        required: true,
        defaultValue: 'markdown',
        options: [
          { label: 'Markdown', value: 'markdown' },
          { label: 'HTML', value: 'html' },
          { label: 'PDF', value: 'pdf' },
        ],
      },
      {
        name: 'scope',
        label: 'Scope',
        description: 'Files or directories to document',
        type: 'text',
        required: false,
        defaultValue: 'entire project',
        placeholder: 'e.g., src/, lib/services/',
      },
      {
        name: 'includeExamples',
        label: 'Include Code Examples',
        type: 'boolean',
        required: false,
        defaultValue: true,
      },
      {
        name: 'includeApiDocs',
        label: 'Include API Reference',
        type: 'boolean',
        required: false,
        defaultValue: false,
      },
      {
        name: 'includeDiagrams',
        label: 'Include Diagrams',
        type: 'boolean',
        required: false,
        defaultValue: false,
      },
      {
        name: 'autoPublish',
        label: 'Auto-publish',
        description: 'Automatically publish to documentation site',
        type: 'boolean',
        required: false,
        defaultValue: false,
      },
    ],

    requiredSkills: ['documentation-standards'],

    preConditions: [],

    checkpoints: [
      {
        id: 'analyze-code',
        title: 'Analyze Codebase',
        description: 'Scan and understand code structure',
        order: 1,
        type: 'action',
      },
      {
        id: 'generate-content',
        title: 'Generate Documentation',
        description: 'Create documentation content',
        order: 2,
        type: 'action',
      },
      {
        id: 'add-examples',
        title: 'Add Examples',
        description: 'Include code examples and snippets',
        order: 3,
        type: 'action',
      },
      {
        id: 'create-diagrams',
        title: 'Create Diagrams',
        description: 'Generate architecture diagrams',
        order: 4,
        type: 'action',
      },
      {
        id: 'review-docs',
        title: 'Review Documentation',
        description: 'Validate completeness and accuracy',
        order: 5,
        type: 'validation',
      },
      {
        id: 'save-docs',
        title: 'Save Documentation',
        description: 'Write docs to appropriate location',
        order: 6,
        type: 'action',
      },
    ],

    output: {
      type: 'file',
      config: {
        targetPath: 'docs/',
      },
      successCriteria: [
        'Documentation generated',
        'Examples included',
        'Proper formatting',
      ],
    },

    validationRules: ['file-placement/docs-location'],

    estimatedTokenCost: 4000,
    version: '1.0.0',
  },

  {
    // 5. Code Review Checklist
    template: `Perform comprehensive code review with checklist:

**Review Scope**: {{reviewScope}}
**Focus Areas**: {{focusAreas}}

Please conduct a thorough code review focusing on:

1. **Code Quality**:
   - Follow coding standards and best practices
   - Check for code smells and anti-patterns
   - Verify proper error handling
   - Assess code maintainability

2. **Security**:
   - {{checkSecurity ? "Identify potential security vulnerabilities" : "Skip security scan"}}
   - Check for exposed secrets or credentials
   - Validate input sanitization
   - Review authentication/authorization logic

3. **Performance**:
   - {{checkPerformance ? "Identify performance bottlenecks" : "Skip performance analysis"}}
   - Check for unnecessary re-renders
   - Review database query efficiency
   - Assess bundle size impact

4. **Testing**:
   - {{checkTestCoverage ? "Verify test coverage meets 80%+ threshold" : "Skip coverage check"}}
   - Review test quality and completeness
   - Check for missing edge cases

5. **Documentation**:
   - Verify code is properly documented
   - Check for outdated comments
   - Review README updates

Provide detailed feedback and actionable recommendations.`,

    variables: [
      {
        name: 'reviewScope',
        label: 'Review Scope',
        description: 'Files or directories to review',
        type: 'text',
        required: false,
        defaultValue: 'all changed files',
        placeholder: 'e.g., src/components/, lib/services/',
      },
      {
        name: 'focusAreas',
        label: 'Focus Areas',
        type: 'multiselect',
        required: true,
        defaultValue: ['code-quality', 'security', 'testing'],
        options: [
          { label: 'Code Quality', value: 'code-quality' },
          { label: 'Security', value: 'security' },
          { label: 'Performance', value: 'performance' },
          { label: 'Testing', value: 'testing' },
          { label: 'Documentation', value: 'documentation' },
          { label: 'Accessibility', value: 'accessibility' },
        ],
      },
      {
        name: 'checkSecurity',
        label: 'Security Scan',
        type: 'boolean',
        required: false,
        defaultValue: true,
      },
      {
        name: 'checkPerformance',
        label: 'Performance Analysis',
        type: 'boolean',
        required: false,
        defaultValue: true,
      },
      {
        name: 'checkTestCoverage',
        label: 'Test Coverage Check',
        type: 'boolean',
        required: false,
        defaultValue: true,
      },
    ],

    requiredSkills: ['code-quality', 'mandatory-tdd'],

    preConditions: [
      {
        id: 'files-to-review',
        type: 'custom',
        description: 'Files available for review',
        config: {
          expression: 'hasFiles()',
        },
        blocking: true,
        errorMessage: 'No files found for review.',
      },
    ],

    checkpoints: [
      {
        id: 'analyze-changes',
        title: 'Analyze Changes',
        description: 'Review file changes and diff',
        order: 1,
        type: 'action',
      },
      {
        id: 'code-quality-check',
        title: 'Code Quality Review',
        description: 'Check coding standards and best practices',
        order: 2,
        type: 'validation',
      },
      {
        id: 'security-scan',
        title: 'Security Scan',
        description: 'Identify security vulnerabilities',
        order: 3,
        type: 'validation',
      },
      {
        id: 'performance-review',
        title: 'Performance Review',
        description: 'Analyze performance implications',
        order: 4,
        type: 'validation',
      },
      {
        id: 'test-review',
        title: 'Test Coverage Review',
        description: 'Verify adequate test coverage',
        order: 5,
        type: 'validation',
      },
      {
        id: 'generate-feedback',
        title: 'Generate Feedback',
        description: 'Compile review findings and recommendations',
        order: 6,
        type: 'action',
      },
    ],

    output: {
      type: 'report',
      config: {
        format: 'markdown',
      },
      successCriteria: [
        'Review completed',
        'Feedback generated',
        'Actionable recommendations provided',
      ],
    },

    validationRules: ['code-quality/naming-conventions', 'mandatory-tdd/min-coverage'],

    estimatedTokenCost: 3500,
    version: '1.0.0',
  },
];
