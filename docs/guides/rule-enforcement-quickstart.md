# Rule Enforcement Framework - Quick Start Guide

This guide will help you get started with the Rule Enforcement Framework in 5 minutes.

## What is Rule Enforcement?

The Rule Enforcement Framework provides **pre-flight validation** for agent actions, ensuring code quality, security, and compliance before changes are committed.

Think of it as a **smart linter** that:
- Blocks forbidden patterns (AI attribution, hardcoded secrets)
- Enforces best practices (testing, code quality)
- Auto-fixes common violations
- Tracks violation history for insights

## Quick Example

```typescript
import { getRuleEnforcementService } from '@/lib/services/rule-enforcement.service';

const service = getRuleEnforcementService();

// Initialize with configuration
await service.initialize({
  projectId: 'my-project',
  ruleSets: ['built-in'],
  ruleConfigs: [],
  settings: {
    autoFix: true,
    strictMode: false,
    continueOnError: true,
  },
});

// Validate a commit before executing
const report = await service.validateAction({
  type: 'commit',
  data: {
    commitMessage: 'feat: add login\n\nGenerated with Claude',
    files: ['src/auth.ts'],
    testOutput: 'Tests passed\n85% coverage',
  },
  userId: 'user-123',
  projectId: 'my-project',
  timestamp: new Date(),
});

// Check results
if (!report.passed) {
  console.log(`Found ${report.errorCount} errors, ${report.warningCount} warnings`);

  // Auto-fix if possible
  if (report.canAutoFix) {
    const violations = report.results.flatMap(r => r.violations);
    const fixed = await service.autoFixViolations(action, violations);
    console.log('Auto-fixed!', fixed.data.commitMessage);
  }
}
```

## Built-in Rules (13 total)

### Zero-Tolerance Rules (Error level)

These rules **must pass** before commits:

1. **`git/no-ai-attribution`** - No third-party AI attribution (Auto-fixable)
2. **`file-placement/no-root-md-files`** - Docs must be in subdirectories
3. **`file-placement/no-backend-scripts`** - Scripts must be in scripts/ folder
4. **`testing/mandatory-execution`** - Tests must be actually run
5. **`testing/min-coverage-80`** - Code coverage >= 80%
6. **`security/no-secrets`** - No hardcoded API keys/passwords
7. **`security/no-pii-logs`** - No PII in log statements
8. **`database/use-schema-sync`** - Use schema sync script

### Best Practice Rules (Warning level)

These rules provide guidance but don't block commits:

9. **`git/commit-message-format`** - Follow conventional commits
10. **`git/branch-naming`** - Use prefix/name format
11. **`file-placement/docs-in-subdirs`** - Organize docs properly
12. **`security/input-validation`** - Validate user input
13. **`code-quality/no-console-log`** - Use proper logger (Auto-fixable)

## Common Scenarios

### Scenario 1: Pre-commit Hook

```typescript
// .husky/pre-commit
import { getRuleEnforcementService } from '@/lib/services/rule-enforcement.service';

const service = getRuleEnforcementService();
await service.initialize({ projectId: 'my-project', ruleSets: ['built-in'] });

const report = await service.validateAction({
  type: 'commit',
  data: {
    commitMessage: getCommitMessage(),
    files: getStagedFiles(),
    testOutput: await runTests(),
  },
  userId: getCurrentUser(),
  projectId: 'my-project',
  timestamp: new Date(),
});

if (!report.passed) {
  console.error('Commit blocked due to violations:');
  report.results.forEach(r => {
    r.violations.forEach(v => {
      console.error(`  - ${v.message}`);
      if (v.suggestion) console.error(`    ${v.suggestion}`);
    });
  });
  process.exit(1);
}
```

### Scenario 2: PR Validation in CI

```yaml
# .github/workflows/pr-validation.yml
name: PR Validation
on: [pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Validate PR
        run: |
          npm run validate:pr
```

```typescript
// scripts/validate-pr.ts
const report = await service.validateAction({
  type: 'pr-create',
  data: {
    prTitle: process.env.PR_TITLE,
    prDescription: process.env.PR_DESCRIPTION,
    baseBranch: process.env.BASE_BRANCH,
    headBranch: process.env.HEAD_BRANCH,
    files: getChangedFiles(),
    testOutput: await runTests(),
  },
  userId: process.env.GITHUB_ACTOR,
  projectId: 'my-project',
  timestamp: new Date(),
});

if (!report.passed) {
  core.setFailed('PR validation failed');
}
```

### Scenario 3: API Integration

```typescript
// app/api/commit/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getRuleEnforcementService } from '@/lib/services/rule-enforcement.service';

export async function POST(request: NextRequest) {
  const { message, files } = await request.json();

  const service = getRuleEnforcementService();
  await service.initialize({ projectId: 'my-project', ruleSets: ['built-in'] });

  const report = await service.validateAction({
    type: 'commit',
    data: { commitMessage: message, files },
    userId: request.headers.get('user-id') || 'anonymous',
    projectId: 'my-project',
    timestamp: new Date(),
  });

  if (!report.passed) {
    return NextResponse.json(
      {
        error: 'Validation failed',
        violations: report.results.flatMap(r => r.violations),
        canAutoFix: report.canAutoFix,
      },
      { status: 400 }
    );
  }

  // Proceed with commit
  return NextResponse.json({ success: true });
}
```

### Scenario 4: UI Integration

```tsx
'use client';

import { useState } from 'react';
import { EnforcementDashboard } from '@/components/enforcement/enforcement-dashboard';

export function CommitForm() {
  const [report, setReport] = useState(null);
  const [message, setMessage] = useState('');

  const handleValidate = async () => {
    const response = await fetch('/api/rules/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'commit',
        data: { commitMessage: message, files: ['src/index.ts'] },
        userId: 'current-user',
        projectId: 'my-project',
      }),
    });

    const result = await response.json();
    setReport(result.report);
  };

  const handleAutoFix = async () => {
    const response = await fetch('/api/rules/auto-fix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: {
          type: 'commit',
          data: { commitMessage: message },
          userId: 'current-user',
          projectId: 'my-project',
        },
        violations: report.violations.filter(v => v.autoFixable),
      }),
    });

    const result = await response.json();
    setMessage(result.action.data.commitMessage);
    setReport(null);
  };

  return (
    <div>
      <textarea value={message} onChange={e => setMessage(e.target.value)} />
      <button onClick={handleValidate}>Validate</button>

      {report && (
        <EnforcementDashboard
          report={report}
          onApplyFixes={handleAutoFix}
        />
      )}
    </div>
  );
}
```

## Auto-fix Examples

The framework can automatically fix these violations:

### AI Attribution
```diff
- Add login feature
-
- Generated with Claude Code

+ Add login feature
+
+ Built by AINative
```

### Console.log
```diff
- console.log('Debug info:', data);
+ logger.info({ data }, 'Debug info');
```

## Custom Rules

Create project-specific rules:

```typescript
import { EnforcementRule } from '@/lib/types/enforcement-rules';

const customRule: EnforcementRule = {
  id: 'custom/no-todo-comments',
  name: 'No TODO Comments',
  description: 'TODO comments must be tracked as issues',
  level: 'warning',
  contexts: ['file-create', 'file-edit'],
  enabled: true,
  category: 'code-quality',
  tags: ['custom', 'comments'],
  check: async (action) => {
    const content = action.data.fileContent || '';
    const hasTodo = /\/\/\s*TODO/i.test(content);

    return {
      ruleId: 'custom/no-todo-comments',
      passed: !hasTodo,
      violations: hasTodo ? [{
        ruleId: 'custom/no-todo-comments',
        level: 'warning',
        message: 'Found TODO comment',
        details: 'Create a GitHub issue instead of TODO comments',
        autoFixable: false,
        suggestion: 'Create an issue: https://github.com/your-org/your-repo/issues/new',
      }] : [],
      duration: 0,
    };
  },
};

// Register the rule
service.registerRule(customRule);
```

## Best Practices

1. **Run Early**: Validate before commits, not after
2. **Auto-fix First**: Always try auto-fix before manual fixes
3. **Track Metrics**: Monitor violation trends
4. **Customize**: Add project-specific rules
5. **Educate**: Share violation insights with the team

## Configuration

```typescript
const config = {
  projectId: 'my-project',
  ruleSets: ['built-in'], // Use built-in rules
  ruleConfigs: [
    {
      ruleId: 'git/commit-message-format',
      level: 'error', // Override to error
      enabled: true,
    },
    {
      ruleId: 'code-quality/no-console-log',
      enabled: false, // Disable for this project
    },
  ],
  settings: {
    autoFix: true, // Auto-fix when possible
    strictMode: false, // Don't fail on warnings
    continueOnError: true, // Check all rules even after errors
    maxViolations: 10, // Stop after 10 violations
  },
};
```

## API Endpoints

- `GET /api/rules` - List all rules
- `GET /api/rules/[ruleId]` - Get rule details
- `POST /api/rules` - Create custom rule
- `PUT /api/rules/[ruleId]` - Update rule
- `DELETE /api/rules/[ruleId]` - Delete rule
- `POST /api/rules/validate` - Validate action
- `POST /api/rules/auto-fix` - Auto-fix violations
- `GET /api/rules/violations` - Get violation history
- `GET /api/rules/stats` - Get statistics

## Troubleshooting

### "No violations detected but commit is blocked"
Check strict mode setting. Warnings block commits in strict mode.

### "Auto-fix not working"
Ensure `settings.autoFix` is `true` and the violation is marked `autoFixable`.

### "Too many violations"
Use `settings.maxViolations` to limit checks, or fix violations incrementally.

### "Rule not triggering"
Check that:
1. Rule is enabled
2. Rule contexts match your action type
3. Rule is registered (for custom rules)

## Next Steps

- Read [Full API Documentation](/docs/api/rule-enforcement.md)
- Explore [Built-in Rules](/lib/services/built-in-rules.ts)
- Review [Test Examples](/__tests__/lib/rule-enforcement.test.ts)
- Create [Custom Rules](#custom-rules)
