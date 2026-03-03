# Rule Enforcement Framework

> Pre-flight validation for agent actions - ensuring code quality, security, and compliance before execution.

## Overview

The Rule Enforcement Framework is a comprehensive system that validates agent actions **before** they're executed, preventing violations of project standards, security policies, and best practices.

### Key Features

- **Pre-flight Validation**: Check actions before commits, PRs, file operations
- **13 Built-in Rules**: Covering Git, file placement, testing, security, code quality
- **Auto-fix Capability**: Automatically fix common violations (AI attribution, console.log, etc.)
- **Violation Tracking**: Historical record of all violations with analytics
- **Custom Rules**: Create project-specific rules with TypeScript
- **API-first Design**: Complete REST API for all operations
- **Real-time UI**: React components for violation display and management
- **Zero-tolerance Enforcement**: Critical rules block execution completely

## Quick Start

```typescript
import { getRuleEnforcementService } from '@/lib/services/rule-enforcement.service';

const service = getRuleEnforcementService();
await service.initialize({
  projectId: 'my-project',
  ruleSets: ['built-in'],
  settings: { autoFix: true },
});

const report = await service.validateAction({
  type: 'commit',
  data: {
    commitMessage: 'feat: add feature',
    files: ['src/feature.ts'],
  },
  userId: 'user-123',
  projectId: 'my-project',
  timestamp: new Date(),
});

if (!report.passed) {
  console.log(`${report.errorCount} errors found`);
}
```

## Built-in Rules

### Zero-Tolerance Rules (Error Level)

| Rule ID | Description | Auto-fix |
|---------|-------------|----------|
| `git/no-ai-attribution` | No third-party AI attribution | ✅ |
| `file-placement/no-root-md-files` | Docs in subdirectories | ❌ |
| `file-placement/no-backend-scripts` | Scripts in scripts/ folder | ❌ |
| `testing/mandatory-execution` | Tests must be run | ❌ |
| `testing/min-coverage-80` | 80% minimum coverage | ❌ |
| `security/no-secrets` | No hardcoded secrets | ❌ |
| `security/no-pii-logs` | No PII in logs | ❌ |
| `database/use-schema-sync` | Use schema sync script | ❌ |

### Best Practice Rules (Warning Level)

| Rule ID | Description | Auto-fix |
|---------|-------------|----------|
| `git/commit-message-format` | Conventional commits | ❌ |
| `git/branch-naming` | Branch naming convention | ❌ |
| `file-placement/docs-in-subdirs` | Organized documentation | ❌ |
| `security/input-validation` | Validate user input | ❌ |
| `code-quality/no-console-log` | Use proper logger | ✅ |

## Architecture

```
┌─────────────────┐
│  Agent Action   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Rule Enforcement│
│    Service      │
└────────┬────────┘
         │
         ├──► Built-in Rules (13)
         ├──► Custom Rules
         ├──► Auto-fix Engine
         └──► Violation Tracker
         │
         ▼
┌─────────────────┐
│ Enforcement     │
│    Report       │
└────────┬────────┘
         │
         ├──► API Response
         ├──► Database Record
         └──► UI Dashboard
```

## API Endpoints

- `GET /api/rules` - List all rules
- `POST /api/rules/validate` - Validate action
- `POST /api/rules/auto-fix` - Auto-fix violations
- `GET /api/rules/violations` - Violation history
- `GET /api/rules/stats` - Statistics

[Full API Documentation](/docs/api/rule-enforcement.md)

## UI Components

### RuleViolationList
Display violations with severity indicators, suggestions, and auto-fix buttons.

### EnforcementDashboard
Comprehensive dashboard showing metrics, pass rate, and detailed violation breakdown.

## Usage Scenarios

### 1. Pre-commit Hook

Validate commits before they're created:

```typescript
const report = await service.validateAction({
  type: 'commit',
  data: { commitMessage, files, testOutput },
  userId: getCurrentUser(),
  projectId: 'my-project',
  timestamp: new Date(),
});

if (!report.passed) {
  throw new Error('Commit blocked due to violations');
}
```

### 2. CI/CD Pipeline

Validate PRs in GitHub Actions:

```yaml
- name: Validate PR
  run: npm run validate:pr
```

### 3. API Integration

Validate actions via REST API:

```bash
curl -X POST /api/rules/validate \
  -d '{"type": "commit", "data": {...}}'
```

### 4. UI Integration

Show violations in your app:

```tsx
<EnforcementDashboard
  report={report}
  onApplyFixes={handleAutoFix}
/>
```

## Custom Rules

Create project-specific rules:

```typescript
const customRule: EnforcementRule = {
  id: 'custom/no-todo-comments',
  name: 'No TODO Comments',
  description: 'TODOs must be tracked as issues',
  level: 'warning',
  contexts: ['file-create', 'file-edit'],
  enabled: true,
  category: 'code-quality',
  tags: ['custom'],
  check: async (action) => {
    const hasTodo = /TODO/i.test(action.data.fileContent || '');
    return {
      ruleId: 'custom/no-todo-comments',
      passed: !hasTodo,
      violations: hasTodo ? [{ ... }] : [],
      duration: 0,
    };
  },
};

service.registerRule(customRule);
```

## Configuration

```typescript
{
  projectId: 'my-project',
  ruleSets: ['built-in'],
  ruleConfigs: [
    {
      ruleId: 'git/commit-message-format',
      level: 'error', // Override level
      enabled: true,
    },
  ],
  settings: {
    autoFix: true,
    strictMode: false,
    continueOnError: true,
    maxViolations: 10,
  },
}
```

## Metrics & Analytics

Track violations over time:

```typescript
const stats = await fetch('/api/rules/stats?projectId=my-project');
// Returns:
// {
//   violations: { total, fixed, pending },
//   reports: { total, passed, failed, passRate },
//   topViolatedRules: [...]
// }
```

## Auto-fix

The framework can automatically fix:

1. **AI Attribution** - Replace with AINative branding
2. **Console.log** - Replace with proper logger
3. *More auto-fixes coming*

```typescript
if (report.canAutoFix) {
  const fixed = await service.autoFixViolations(action, violations);
}
```

## Testing

### Unit Tests
23 comprehensive tests covering all rule categories:

```bash
npm test -- __tests__/lib/rule-enforcement.test.ts
```

### Integration Tests
API endpoint tests with database operations:

```bash
npm test -- __tests__/api/rules.test.ts
```

## Performance

- **Parallel Execution**: Rules run in parallel
- **Average Duration**: <50ms for 13 rules
- **Database Optimized**: Indexed queries
- **Caching**: Singleton service pattern

## Database Schema

### Tables Created

1. `rule_sets` - Collections of rules
2. `enforcement_rules` - Individual rules
3. `rule_violations` - Violation history
4. `enforcement_reports` - Report summaries
5. `enforcement_configs` - Project configs

[Full Schema Details](/lib/db/schema.ts)

## Files Created

### Core Services
- `/lib/services/built-in-rules.ts` - 13 built-in rules
- `/lib/services/rule-enforcement.service.ts` - Main service
- `/lib/services/rule-enforcement-db.service.ts` - Database service

### API Endpoints
- `/app/api/rules/route.ts` - List/create rules
- `/app/api/rules/[ruleId]/route.ts` - Get/update/delete
- `/app/api/rules/validate/route.ts` - Validate action
- `/app/api/rules/auto-fix/route.ts` - Auto-fix
- `/app/api/rules/violations/route.ts` - Violations
- `/app/api/rules/stats/route.ts` - Statistics

### UI Components
- `/components/enforcement/rule-violation-list.tsx`
- `/components/enforcement/enforcement-dashboard.tsx`

### Tests
- `/__tests__/lib/rule-enforcement.test.ts` - 23 unit tests
- `/__tests__/api/rules.test.ts` - Integration tests

### Documentation
- `/docs/api/rule-enforcement.md` - Full API reference
- `/docs/guides/rule-enforcement-quickstart.md` - Quick start guide
- `/docs/reports/rule-enforcement-implementation-summary.md` - Summary

## Best Practices

1. **Validate Early** - Before commits, not after
2. **Auto-fix First** - Always try auto-fix
3. **Track Trends** - Monitor violation patterns
4. **Customize** - Add project-specific rules
5. **Educate** - Share insights with team

## Troubleshooting

### Common Issues

**Commit blocked unexpectedly**
- Check strict mode setting
- Review violation details
- Try auto-fix if available

**Auto-fix not working**
- Ensure `settings.autoFix` is true
- Verify violation is auto-fixable
- Check auto-fix implementation

**Too many violations**
- Use `maxViolations` setting
- Fix violations incrementally
- Disable non-critical rules temporarily

## Future Enhancements

- [ ] Rule configuration UI
- [ ] Visual rule builder
- [ ] IDE integration (VS Code)
- [ ] ML-powered suggestions
- [ ] Team-level rule sets
- [ ] Compliance reporting
- [ ] Analytics dashboard

## Support

- **Documentation**: `/docs/api/rule-enforcement.md`
- **Quick Start**: `/docs/guides/rule-enforcement-quickstart.md`
- **Tests**: `/__tests__/lib/rule-enforcement.test.ts`
- **Issues**: GitHub Issue #18

## License

Part of AINative Studio - Proprietary

---

**Status**: ✅ Production Ready
**Version**: 1.0.0
**Last Updated**: March 2, 2026
