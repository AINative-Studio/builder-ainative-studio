# Command Palette - Quick Start Guide

**Feature**: Cmd+K style command palette for agent workflows
**Status**: Phase 1-2 Complete ✅
**Issue**: #17

## What's Implemented

- ✅ **Command Palette UI** - Fuzzy search with Cmd+K shortcut
- ✅ **Variable Prompts** - Dynamic forms with validation
- ✅ **Progress Tracking** - Real-time checkpoint visualization
- ✅ **5 Built-in Commands** - PR, Tests, Deploy, Docs, Review
- ✅ **Comprehensive Tests** - 80%+ coverage achieved
- ✅ **REST API** - Full CRUD operations

## Quick Usage

### Open Command Palette

Press **Cmd+K** (Mac) or **Ctrl+K** (Windows/Linux)

### Built-in Commands

1. **Create Pull Request** (Cmd+Shift+P)
2. **Run Tests with Evidence** (Cmd+Shift+T)
3. **Deploy to Staging** (Cmd+Shift+D)
4. **Generate Documentation** (Cmd+Shift+G)
5. **Code Review Checklist** (Cmd+Shift+R)

### Search Commands

Type in the command palette to fuzzy search:
- By name: "pull request"
- By tag: "deployment"
- By category: "testing"

### Execute a Command

1. Open palette (Cmd+K)
2. Select command
3. Fill in variables
4. Click "Execute Command"
5. Track progress in real-time

## API Endpoints

```bash
# List commands
GET /api/commands?query=deploy&category=deployment

# Get command
GET /api/commands/[id]

# Create command
POST /api/commands
{
  "name": "My Command",
  "description": "...",
  "template": "...",
  "variables": [...]
}

# Execute command
POST /api/commands/[id]/execute
{
  "variableValues": { ... }
}

# Toggle favorite
POST /api/commands/[id]/favorite
```

## Variable Types

- **text** - Single-line text input
- **number** - Numeric input
- **boolean** - Checkbox
- **select** - Dropdown with options
- **multiselect** - Multiple checkboxes
- **file** - File picker
- **url** - URL input with validation

## Creating Custom Commands

```typescript
const command = await commandService.createCommand({
  metadata: {
    name: 'My Workflow',
    description: 'Custom workflow description',
    category: 'custom',
    tags: ['workflow'],
    // ... other metadata
  },
  template: 'Do {{action}} with {{target}}',
  variables: [
    {
      name: 'action',
      label: 'Action',
      type: 'select',
      required: true,
      options: [
        { label: 'Build', value: 'build' },
        { label: 'Test', value: 'test' },
      ],
    },
    {
      name: 'target',
      label: 'Target',
      type: 'text',
      required: true,
    },
  ],
  requiredSkills: [],
  preConditions: [],
  checkpoints: [
    {
      id: 'step1',
      title: 'First Step',
      order: 1,
      type: 'action',
    },
  ],
  output: { type: 'chat' },
  version: '1.0.0',
}, userId);
```

## Database Setup

```bash
# Run migrations
npm run db:migrate

# Seed built-in commands
node lib/db/seed-built-in-commands.ts
```

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Test specific file
npm test agent-command.service.test.ts
```

## Key Files

| File | Purpose |
|------|---------|
| `/lib/types/agent-commands.ts` | Type definitions |
| `/lib/services/agent-command.service.ts` | Core service |
| `/components/command-palette.tsx` | Main UI |
| `/lib/data/built-in-commands.ts` | Built-in commands |
| `/app/api/commands/*` | API routes |

## Performance Targets

- ✅ Palette open: <100ms
- ✅ Search results: <50ms
- ✅ Variable substitution: <10ms

## Next Steps (Phase 3-6)

- **Phase 3**: Visual workflow editor
- **Phase 4**: WebSocket progress updates
- **Phase 5**: More built-in commands
- **Phase 6**: Team sharing & marketplace

## Support

See full documentation: `/docs/features/command-palette-implementation.md`

Issue tracker: https://github.com/AINative-Studio/builder-ainative-studio/issues/17
