# Rule Enforcement Framework API

The Rule Enforcement Framework provides pre-flight validation for agent actions, ensuring code quality, security, and compliance with project standards.

## Overview

- **Pre-flight Validation**: Validate actions before they're executed
- **13 Built-in Rules**: Git, file placement, testing, security, code quality, database
- **Auto-fix Capability**: Automatically fix common violations
- **Customizable**: Create custom rules for your project
- **Violation Tracking**: Historical record of all violations
- **Comprehensive Reporting**: Detailed enforcement reports with metrics

## API Endpoints

### List All Rules

```http
GET /api/rules
```

Query Parameters:
- `category` (optional): Filter by category (git, file-placement, testing, security, etc.)
- `enabled` (optional): Filter by enabled status (true/false)
- `level` (optional): Filter by severity level (error, warning, info)

Response:
```json
{
  "success": true,
  "rules": [
    {
      "id": "git/no-ai-attribution",
      "name": "No Third-Party AI Attribution",
      "description": "Block third-party AI tool attribution...",
      "level": "error",
      "category": "git",
      "contexts": ["commit", "pr-create"],
      "enabled": true,
      "tags": ["git", "commit", "attribution"],
      "created_at": "2026-03-02T10:00:00Z"
    }
  ],
  "count": 13
}
```

### Get a Specific Rule

```http
GET /api/rules/[ruleId]
```

Response:
```json
{
  "success": true,
  "rule": {
    "id": "git/no-ai-attribution",
    "name": "No Third-Party AI Attribution",
    "description": "Block third-party AI tool attribution...",
    "level": "error",
    "category": "git",
    "contexts": ["commit", "pr-create"],
    "enabled": true,
    "tags": ["git", "commit", "attribution"],
    "examples": [
      {
        "invalid": "Add feature\\n\\nGenerated with Claude Code",
        "valid": "Add feature\\n\\nBuilt by AINative",
        "explanation": "Replace third-party AI attribution with AINative branding"
      }
    ]
  }
}
```

### Create a Custom Rule

```http
POST /api/rules
```

Request Body:
```json
{
  "id": "custom/my-rule",
  "name": "My Custom Rule",
  "description": "Description of the rule",
  "level": "warning",
  "category": "code-quality",
  "contexts": ["file-create", "file-edit"],
  "enabled": true,
  "tags": ["custom"],
  "docsUrl": "https://example.com/docs/my-rule",
  "examples": [
    {
      "invalid": "Bad code example",
      "valid": "Good code example",
      "explanation": "Why this is better"
    }
  ]
}
```

Response:
```json
{
  "success": true,
  "rule": { ... },
  "message": "Rule created successfully"
}
```

### Update a Rule

```http
PUT /api/rules/[ruleId]
```

Request Body:
```json
{
  "name": "Updated Name",
  "enabled": false
}
```

### Delete a Rule

```http
DELETE /api/rules/[ruleId]
```

Note: Built-in rules cannot be deleted.

### Validate an Action

```http
POST /api/rules/validate
```

Request Body:
```json
{
  "type": "commit",
  "data": {
    "commitMessage": "feat(auth): add user login\\n\\nGenerated with Claude",
    "files": ["src/auth.ts"],
    "testOutput": "All tests passed\\n85% coverage"
  },
  "userId": "user-123",
  "projectId": "project-456"
}
```

Response:
```json
{
  "success": true,
  "report": {
    "passed": false,
    "errorCount": 1,
    "warningCount": 0,
    "infoCount": 0,
    "totalDuration": 45,
    "canAutoFix": true,
    "suggestions": [
      "Replace with: Built by AINative"
    ],
    "violations": [
      {
        "ruleId": "git/no-ai-attribution",
        "level": "error",
        "message": "Forbidden third-party AI attribution detected: Generated with Claude",
        "details": "Found Generated with Claude in commit...",
        "autoFixable": true,
        "suggestion": "Replace with: Built by AINative"
      }
    ]
  }
}
```

### Auto-fix Violations

```http
POST /api/rules/auto-fix
```

Request Body:
```json
{
  "action": {
    "type": "commit",
    "data": {
      "commitMessage": "feat: add feature\\n\\nGenerated with Claude"
    },
    "userId": "user-123",
    "projectId": "project-456"
  },
  "violations": [
    {
      "ruleId": "git/no-ai-attribution",
      "level": "error",
      "message": "...",
      "autoFixable": true
    }
  ]
}
```

Response:
```json
{
  "success": true,
  "message": "Auto-fixed 1 violation(s)",
  "action": {
    "type": "commit",
    "data": {
      "commitMessage": "feat: add feature\\n\\nBuilt by AINative"
    }
  },
  "fixedCount": 1,
  "duration": 12,
  "fixes": [
    {
      "ruleId": "git/no-ai-attribution",
      "message": "Forbidden third-party AI attribution detected",
      "suggestion": "Replace with: Built by AINative"
    }
  ]
}
```

### Get Violations

```http
GET /api/rules/violations
```

Query Parameters:
- `userId` (optional): Filter by user
- `projectId` (optional): Filter by project
- `ruleId` (optional): Filter by rule
- `fixed` (optional): Filter by fixed status (true/false)
- `limit` (optional): Max results (default: 100)

Response:
```json
{
  "success": true,
  "violations": [
    {
      "id": "violation-123",
      "rule_id": "git/no-ai-attribution",
      "user_id": "user-456",
      "project_id": "project-789",
      "action_type": "commit",
      "violation_message": "Forbidden third-party AI attribution detected",
      "auto_fixable": true,
      "fixed": false,
      "created_at": "2026-03-02T10:00:00Z"
    }
  ],
  "stats": {
    "total": 50,
    "fixed": 30,
    "autoFixed": 20,
    "manualFixed": 10,
    "ignored": 5,
    "pending": 20
  },
  "count": 50
}
```

### Get Statistics

```http
GET /api/rules/stats
```

Query Parameters:
- `userId` (optional): Filter by user
- `projectId` (optional): Filter by project
- `ruleId` (optional): Filter by rule

Response:
```json
{
  "success": true,
  "stats": {
    "violations": {
      "total": 100,
      "fixed": 60,
      "autoFixed": 40,
      "manualFixed": 20,
      "ignored": 10,
      "pending": 40
    },
    "reports": {
      "total": 200,
      "passed": 150,
      "failed": 50,
      "passRate": 75.0
    },
    "topViolatedRules": [
      {
        "ruleId": "git/no-ai-attribution",
        "count": 25
      },
      {
        "ruleId": "security/no-secrets",
        "count": 15
      }
    ]
  }
}
```

## Built-in Rules

### Git Rules

#### `git/no-ai-attribution` (Error, Auto-fixable)
Blocks third-party AI tool attribution (Claude, Anthropic, ChatGPT, Copilot) in commits and PRs.

**Invalid:**
```
Add user authentication

Generated with Claude Code
```

**Valid:**
```
Add user authentication

Built by AINative
```

#### `git/commit-message-format` (Warning)
Enforces conventional commit format: `type(scope): description`

**Invalid:**
```
added some stuff
```

**Valid:**
```
feat(auth): add user login
```

#### `git/branch-naming` (Warning)
Enforces branch naming: `feature/*`, `bugfix/*`, `hotfix/*`, etc.

**Invalid:**
```
my-new-feature
```

**Valid:**
```
feature/user-authentication
```

### File Placement Rules

#### `file-placement/no-root-md-files` (Error)
Documentation files must be in `docs/` subdirectories (except README.md, CODY.md).

**Invalid:**
```
SETUP_GUIDE.md
```

**Valid:**
```
docs/guides/SETUP_GUIDE.md
```

#### `file-placement/no-backend-scripts` (Error)
Shell scripts must be in `scripts/` folder (except start.sh).

**Invalid:**
```
backend/deploy.sh
```

**Valid:**
```
scripts/deploy/backend.sh
```

#### `file-placement/docs-in-subdirs` (Warning)
Documentation in `docs/` must be in appropriate subdirectories.

### Testing Rules

#### `testing/mandatory-execution` (Error)
Tests must be actually run before commits/PRs, with proof of execution.

#### `testing/min-coverage-80` (Error)
Code coverage must be at least 80%.

#### `testing/include-output` (Warning)
Test output should be included in commit messages or PR descriptions.

### Security Rules

#### `security/no-secrets` (Error)
Prevents committing API keys, passwords, tokens.

**Invalid:**
```typescript
const apiKey = "sk_live_abc123...";
```

**Valid:**
```typescript
const apiKey = process.env.STRIPE_API_KEY;
```

#### `security/no-pii-logs` (Error)
Prevents logging personally identifiable information.

**Invalid:**
```typescript
console.log("User password:", user.password);
```

**Valid:**
```typescript
logger.info({ userId: user.id }, "User logged in");
```

#### `security/input-validation` (Warning)
User input must be validated before processing.

**Invalid:**
```typescript
const { email } = request.body;
```

**Valid:**
```typescript
const { email } = schema.parse(request.body);
```

### Code Quality Rules

#### `code-quality/no-console-log` (Warning, Auto-fixable)
Use proper logger instead of console.log.

**Invalid:**
```typescript
console.log("Debug info:", data);
```

**Valid:**
```typescript
logger.debug({ data }, "Debug info");
```

### Database Rules

#### `database/use-schema-sync` (Error)
Use `scripts/sync-production-schema.py` instead of direct Alembic migrations.

**Invalid:**
```bash
alembic upgrade head
```

**Valid:**
```bash
python scripts/sync-production-schema.py
```

## Usage Examples

### Client-side Usage

```typescript
import { useState } from 'react';
import { EnforcementDashboard } from '@/components/enforcement/enforcement-dashboard';

export function CommitValidation() {
  const [report, setReport] = useState(null);

  const validateCommit = async (message: string, files: string[]) => {
    const response = await fetch('/api/rules/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'commit',
        data: { commitMessage: message, files },
        userId: 'current-user-id',
        projectId: 'current-project-id',
      }),
    });

    const result = await response.json();
    setReport(result.report);
  };

  const handleAutoFix = async () => {
    // Auto-fix implementation
  };

  return (
    <div>
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

### Server-side Usage

```typescript
import { getRuleEnforcementService } from '@/lib/services/rule-enforcement.service';

const service = getRuleEnforcementService();

await service.initialize({
  projectId: 'my-project',
  ruleSets: ['built-in'],
  ruleConfigs: [],
  settings: {
    autoFix: false,
    strictMode: false,
    continueOnError: true,
  },
});

const report = await service.validateAction({
  type: 'commit',
  data: {
    commitMessage: 'feat: add feature',
    files: ['src/feature.ts'],
    testOutput: 'Tests passed\n85% coverage',
  },
  userId: 'user-123',
  projectId: 'my-project',
  timestamp: new Date(),
});

if (!report.passed) {
  console.log(`${report.errorCount} errors found`);
  console.log('Violations:', report.results.flatMap(r => r.violations));
}
```

## Error Handling

All API endpoints return consistent error responses:

```json
{
  "success": false,
  "error": "Error message",
  "details": "Detailed error information"
}
```

Common HTTP status codes:
- `200`: Success
- `201`: Created
- `400`: Validation error
- `403`: Forbidden (e.g., trying to delete built-in rule)
- `404`: Not found
- `500`: Internal server error

## Best Practices

1. **Validate Early**: Run validation before committing or creating PRs
2. **Auto-fix When Possible**: Use auto-fix for common violations
3. **Monitor Violations**: Track violation trends to improve code quality
4. **Customize Rules**: Create project-specific rules for your workflow
5. **Enable Strict Mode**: Use strict mode in CI/CD pipelines
6. **Review Reports**: Regularly review enforcement reports for insights

## TypeScript Types

```typescript
import type {
  EnforcementRule,
  RuleViolation,
  EnforcementReport,
  AgentAction,
  RuleContext,
  RuleLevel,
} from '@/lib/types/enforcement-rules';
```
