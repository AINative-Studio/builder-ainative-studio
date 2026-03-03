# Test Plan: Custom Prompt Generation Workflow (Issue #11)

## Overview

Comprehensive testing plan for validating custom prompt generation with and without subagents, as specified in GitHub Issue #11.

## Objectives

Test the custom prompt generation workflow to ensure:
- All test prompts generate valid, renderable components
- Both USE_SUBAGENTS modes work correctly
- Performance meets defined thresholds
- Output quality is production-ready

## Test Environment

### Prerequisites
- Node.js 18+ installed
- ANTHROPIC_API_KEY configured in `.env`
- All dependencies installed (`npm install`)
- Redis server running (for integration tests)

### Configuration
```bash
# Required environment variables
ANTHROPIC_API_KEY=<your-key>
ANTHROPIC_MODEL=claude-sonnet-4-20250514
REDIS_URL=redis://localhost:6379
```

## Test Prompts (from Issue #11)

1. "Create a landing page for a SaaS product"
2. "Build a dashboard with revenue charts"
3. "Design a contact form with email validation"
4. "Make a product showcase grid with filters"
5. "Generate a blog post layout with sidebar"

## Test Matrix

| Prompt # | Prompt | USE_SUBAGENTS=true | USE_SUBAGENTS=false |
|----------|--------|-------------------|---------------------|
| 1 | Landing page | ✅ Test | ✅ Test |
| 2 | Dashboard | ✅ Test | ✅ Test |
| 3 | Contact form | ✅ Test | ✅ Test |
| 4 | Product grid | ✅ Test | ✅ Test |
| 5 | Blog layout | ✅ Test | ✅ Test |

**Total Tests**: 10 integration tests + unit tests for subagent components

## Success Criteria

### 1. Component Generation
- ✅ All prompts generate valid React components
- ✅ Components are self-contained (no missing imports)
- ✅ Code syntax is valid (passes validation)
- ✅ Components export default function

### 2. Performance
- ✅ Generation time < 30 seconds per prompt
- ✅ No timeout errors
- ✅ Subagent orchestration completes within reasonable time

### 3. Preview Rendering
- ✅ Components render without console errors
- ✅ Components contain proper JSX structure
- ✅ No missing dependencies or broken imports

### 4. Quality Validation
- ✅ Code passes syntax validation
- ✅ No gradients (solid colors only)
- ✅ No emoticons (icon libraries only)
- ✅ All data variables defined before use

### 5. Token Usage (Standard Mode Only)
- ✅ Token usage tracked and reported
- ✅ Input tokens logged
- ✅ Output tokens logged
- ✅ Cache hit/miss tracked

## Test Structure

### Unit Tests
**File**: `__tests__/unit/subagents.test.ts`

Tests individual subagent functions:
- `runDesignSubagent()` - Design analysis
- `runCodeSubagent()` - Code generation
- `runValidationSubagent()` - Quality validation
- `runOrchestratorAgent()` - Full workflow orchestration

**Coverage**:
- Function behavior
- Error handling
- Response structure
- Metadata tracking
- Performance benchmarks

### Integration Tests
**File**: `__tests__/integration/prompt-generation.test.ts`

Tests end-to-end prompt generation workflow:
- 5 prompts × 2 modes = 10 integration tests
- Performance validation
- Quality checks
- Comprehensive reporting

**Test Suites**:
1. WITH USE_SUBAGENTS=true (Orchestrator Mode)
2. WITH USE_SUBAGENTS=false (Standard Mode)
3. Performance and Quality Validation

## Running the Tests

### Quick Start
```bash
# Run all Issue #11 tests
./scripts/run-issue-11-tests.sh
```

### Manual Execution
```bash
# Run unit tests only
npm run test -- __tests__/unit/subagents.test.ts

# Run integration tests only
npm run test -- __tests__/integration/prompt-generation.test.ts

# Run with coverage
npm run test:coverage -- __tests__/unit/subagents.test.ts
npm run test:coverage -- __tests__/integration/prompt-generation.test.ts

# Run specific test
npm run test -- -t "should generate valid component"
```

### Expected Duration
- **Unit tests**: ~3-5 minutes
- **Integration tests**: ~5-10 minutes
- **Total**: ~10-15 minutes

## Test Outputs

### Console Output
- Real-time test progress
- Performance metrics per test
- Validation results
- Comprehensive summary report

### Log Files (when using test script)
- `test-results-unit.log` - Unit test execution log
- `test-results-integration.log` - Integration test execution log
- `test-results-summary.md` - Markdown summary report

### Performance Metrics Tracked
- Generation time (ms)
- Token usage (input/output/total)
- Component code size (characters)
- Success/failure rates
- Validation pass rates

## Quality Gates

Tests must pass the following quality gates:

1. **100% Success Rate**: All 10 integration tests must pass
2. **Zero Validation Errors**: All generated code must be syntactically valid
3. **30-Second Threshold**: All generations must complete in < 30s
4. **Minimum Code Size**: Components must be > 500 characters (substantial)
5. **Export Compliance**: All components must export default function

## Troubleshooting

### Common Issues

**Issue**: Tests fail with "ANTHROPIC_API_KEY not set"
**Solution**: Ensure `.env` file contains `ANTHROPIC_API_KEY=<your-key>`

**Issue**: Tests timeout after 30 seconds
**Solution**: Increase test timeout in vitest config or check network connectivity

**Issue**: Validation errors for generated code
**Solution**: Review code-validator.ts logic; may need to update validation rules

**Issue**: Rate limiting errors from Anthropic API
**Solution**: Add delays between tests (already included in test suite)

## Test Maintenance

### Updating Test Prompts
Edit `TEST_PROMPTS` array in `__tests__/integration/prompt-generation.test.ts`:
```typescript
const TEST_PROMPTS = [
  'Your new test prompt here',
  // ... more prompts
]
```

### Adjusting Timeouts
Edit vitest.config.ts:
```typescript
testTimeout: 60000, // 60 seconds
```

### Adding New Success Criteria
Add new test cases in the "Performance and Quality Validation" suite.

## Reporting Results

### Creating Test Report
After running tests, review:
1. Console output for summary statistics
2. `test-results-summary.md` for formatted report
3. Individual log files for detailed execution traces

### Metrics to Report
- Total tests run
- Success rate percentage
- Validation pass rate percentage
- Average generation time (subagents vs standard)
- Average token usage (standard mode)
- Average component size

### Example Report Format
```
CUSTOM PROMPT GENERATION TEST RESULTS (GitHub Issue #11)
========================================================================

Total tests run: 10
  - Subagents mode: 5
  - Standard mode: 5

Success rate: 100.0%
Validation pass rate: 100.0%

--- Performance Metrics ---
Average generation time (subagents): 18.45s
Average generation time (standard): 12.32s
Average token usage (standard): 4523 tokens

--- Quality Metrics ---
Average component size: 1847 characters
All components have export default: YES
```

## Next Steps After Testing

1. ✅ Review test results and logs
2. ✅ Ensure all success criteria are met
3. ✅ Document any issues or edge cases found
4. ✅ Create PR with test suite
5. ✅ Comment on issue #11 with test results
6. ✅ Close issue if all tests pass

## References

- **GitHub Issue**: #11
- **Implementation Plan**: `docs/reports/BUILDER_AINATIVE_STUDIO_IMPLEMENTATION_PLAN.md` (Phase 5, Task 5.1)
- **Subagents Architecture**: `lib/agent/subagents.ts`
- **Code Validator**: `lib/code-validator.ts`
- **Component Generation Tool**: `lib/agent/component-generation-tool.ts`

---
**Document Version**: 1.0
**Last Updated**: 2026-03-02
**Author**: QA Team
