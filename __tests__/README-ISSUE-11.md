# Test Suite for GitHub Issue #11

## Custom Prompt Generation Workflow Testing

This test suite validates the custom prompt generation workflow with both USE_SUBAGENTS=true and USE_SUBAGENTS=false modes.

## Test Files

- `__tests__/integration/prompt-generation-issue-11.test.ts` - Comprehensive integration tests

## Test Prompts

1. "Create a landing page for a SaaS product"
2. "Build a dashboard with revenue charts"
3. "Design a contact form with email validation"
4. "Make a product showcase grid with filters"
5. "Generate a blog post layout with sidebar"

## Success Criteria

- ✅ All prompts generate valid components
- ✅ Preview renders correctly (no console errors)
- ✅ Generation time < 30 seconds
- ✅ Code validation passes
- ✅ Token usage tracked (standard mode)

## Running Tests

```bash
# Run Issue #11 tests
npm run test -- __tests__/integration/prompt-generation-issue-11.test.ts --reporter=verbose

# With coverage
npm run test:coverage -- __tests__/integration/prompt-generation-issue-11.test.ts
```

## Expected Duration

- Total: ~10-15 minutes (10 API calls with 2s delays between tests)
- Per test: ~20-25 seconds average

## Environment Requirements

```env
ANTHROPIC_API_KEY=<your-key>
ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

## Test Output

Tests generate a performance report including:
- Success rate
- Validation pass rate
- Average generation time (subagents vs standard)
- Average token usage (standard mode only)

---
**Created for**: GitHub Issue #11
**Date**: 2026-03-02
