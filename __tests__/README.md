# Test Suite for Builder AINative Studio

## Overview

This directory contains comprehensive test suites for the Builder AINative Studio application, focusing on critical features like custom prompt generation, subagent orchestration, and code validation.

## Directory Structure

```
__tests__/
├── README.md                          # This file
├── integration/
│   └── prompt-generation.test.ts      # Issue #11: Custom prompt generation tests
└── unit/
    └── subagents.test.ts              # Unit tests for subagent components
```

## Test Categories

### Integration Tests
**Location**: `__tests__/integration/`

End-to-end tests that validate complete workflows:
- Custom prompt generation workflow (Issue #11)
- Subagent orchestration (USE_SUBAGENTS=true)
- Standard streaming generation (USE_SUBAGENTS=false)
- Performance benchmarking
- Quality validation

**Key Features**:
- Tests real API calls to Anthropic Claude
- Validates complete user journeys
- Measures actual performance metrics
- Produces comprehensive test reports

### Unit Tests
**Location**: `__tests__/unit/`

Focused tests for individual components:
- Design subagent functionality
- Code generation subagent
- Validation subagent
- Orchestrator coordination
- Error handling

**Key Features**:
- Fast execution (minimal API calls)
- Isolated component testing
- Edge case coverage
- Error scenario validation

## Running Tests

### All Tests
```bash
# Run all tests
npm run test

# Run with coverage
npm run test:coverage
```

### Specific Test Suites
```bash
# Run unit tests only
npm run test -- __tests__/unit/

# Run integration tests only
npm run test -- __tests__/integration/

# Run Issue #11 tests (recommended)
./scripts/run-issue-11-tests.sh
```

### Individual Test Files
```bash
# Run specific test file
npm run test -- __tests__/unit/subagents.test.ts

# Run with verbose output
npm run test -- __tests__/unit/subagents.test.ts --reporter=verbose

# Run specific test case
npm run test -- -t "should generate valid component"
```

### Watch Mode
```bash
# Run tests in watch mode (auto-rerun on changes)
npm run test:watch
```

## Test Configuration

### Environment Setup
Required environment variables (set in `.env`):
```bash
ANTHROPIC_API_KEY=<your-api-key>
ANTHROPIC_MODEL=claude-sonnet-4-20250514
REDIS_URL=redis://localhost:6379
```

### Vitest Configuration
**File**: `vitest.config.ts`

Key settings:
- Test timeout: 30 seconds (adjustable for long-running tests)
- Coverage provider: v8
- Coverage threshold: 80% (lines, functions, branches, statements)
- Setup file: `vitest.setup.ts`

## Test Standards

### Writing Tests
Follow these best practices:

1. **Use BDD-style descriptions**:
   ```typescript
   describe('Feature Name', () => {
     it('should do something specific', () => {
       // test implementation
     })
   })
   ```

2. **Test both success and failure cases**:
   ```typescript
   it('should handle valid input', () => { /* ... */ })
   it('should handle invalid input gracefully', () => { /* ... */ })
   ```

3. **Include performance checks**:
   ```typescript
   const startTime = Date.now()
   await functionUnderTest()
   const duration = Date.now() - startTime
   expect(duration).toBeLessThan(5000) // 5 second threshold
   ```

4. **Validate all success criteria**:
   - Output exists and has expected structure
   - No errors thrown
   - Performance meets thresholds
   - Quality gates pass

### Test Timeouts
- Unit tests: 30 seconds default
- Integration tests: 60 seconds (API calls)
- Full workflows: 90 seconds (orchestrator)

Adjust per-test:
```typescript
it('should complete long operation', async () => {
  // test code
}, 120000) // 120 second timeout
```

## Issue #11 Test Suite

### Purpose
Comprehensive testing of custom prompt generation workflow with both subagent and standard modes.

### Test Prompts
1. "Create a landing page for a SaaS product"
2. "Build a dashboard with revenue charts"
3. "Design a contact form with email validation"
4. "Make a product showcase grid with filters"
5. "Generate a blog post layout with sidebar"

### Success Criteria
- ✅ All prompts generate valid components
- ✅ Preview renders correctly (no console errors)
- ✅ Generation time < 30 seconds
- ✅ Code validation passes
- ✅ Token usage tracked (standard mode)

### Running Issue #11 Tests
```bash
# Recommended: Use test runner script
./scripts/run-issue-11-tests.sh

# Manual execution
npm run test -- __tests__/integration/prompt-generation.test.ts --reporter=verbose
```

### Expected Duration
- **Unit tests**: ~3-5 minutes
- **Integration tests**: ~5-10 minutes
- **Total**: ~10-15 minutes

### Output Files
- `test-results-unit.log` - Unit test execution log
- `test-results-integration.log` - Integration test details
- `test-results-summary.md` - Formatted summary report

## CI/CD Integration

### GitHub Actions (Future)
Recommended workflow:
```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm run test:coverage
      - uses: codecov/codecov-action@v3
```

### Pre-commit Hooks
Consider adding:
```json
{
  "husky": {
    "hooks": {
      "pre-commit": "npm run test:unit"
    }
  }
}
```

## Coverage Reports

### Viewing Coverage
```bash
# Generate coverage report
npm run test:coverage

# Open HTML report
open coverage/index.html
```

### Coverage Targets
Minimum coverage thresholds:
- Lines: 80%
- Functions: 80%
- Branches: 80%
- Statements: 80%

## Troubleshooting

### Common Issues

**Tests fail with API key error**
```
Solution: Ensure ANTHROPIC_API_KEY is set in .env file
```

**Tests timeout**
```
Solution: Increase timeout in vitest.config.ts or test file
```

**Rate limiting from Anthropic**
```
Solution: Tests include 2-second delays between API calls
If issues persist, increase delay in test files
```

**Redis connection errors**
```
Solution: Ensure Redis is running: redis-server
Or update REDIS_URL in .env
```

## Contributing

### Adding New Tests

1. **Choose appropriate location**:
   - `__tests__/unit/` - Individual component tests
   - `__tests__/integration/` - End-to-end workflow tests

2. **Follow naming convention**:
   - Unit: `<component-name>.test.ts`
   - Integration: `<feature-name>.test.ts`

3. **Include documentation**:
   - Add JSDoc comments
   - Document test purpose
   - Reference related issues/PRs

4. **Update package.json** (if needed):
   ```json
   {
     "scripts": {
       "test:your-feature": "vitest run __tests__/path/to/tests"
     }
   }
   ```

### Test Review Checklist
- [ ] Tests follow BDD style (describe/it)
- [ ] Success and failure cases covered
- [ ] Performance benchmarks included
- [ ] Error handling validated
- [ ] Documentation updated
- [ ] CI/CD integration considered

## Resources

### Related Documentation
- [Test Plan for Issue #11](../docs/testing/ISSUE-11-TEST-PLAN.md)
- [Implementation Plan](../docs/reports/BUILDER_AINATIVE_STUDIO_IMPLEMENTATION_PLAN.md)
- [Vitest Documentation](https://vitest.dev/)

### Key Files
- `vitest.config.ts` - Test configuration
- `vitest.setup.ts` - Test setup and mocks
- `scripts/run-issue-11-tests.sh` - Test runner script

### Support
For questions or issues with tests:
1. Check this README
2. Review test plan documentation
3. Check existing test files for examples
4. Open an issue on GitHub

---
**Last Updated**: 2026-03-02
**Maintained By**: QA Team
