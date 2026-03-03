# Context Budget Manager

A comprehensive token budget management system that helps users optimize context usage through smart loading, real-time tracking, and intelligent optimization suggestions.

## Overview

The Context Budget Manager addresses the critical problem of token exhaustion in AI conversations by providing:

- **Real-time Token Tracking**: Monitor token consumption as context items are loaded
- **Smart Loading Decisions**: Automatically evaluate whether items can be loaded within budget
- **Budget Visualization**: Beautiful UI components showing budget breakdown and usage
- **Optimization Suggestions**: AI-powered recommendations for reducing token usage
- **Auto-unload**: Automatically remove low-priority items when budget is critical
- **Budget Alerts**: Warning and critical threshold notifications

## Architecture

### Components

```
context-budget/
├── types/
│   └── context-budget.ts         # TypeScript type definitions
├── services/
│   └── context-budget.service.ts # Core business logic
├── api/
│   ├── budget/route.ts           # GET budget endpoint
│   ├── track/route.ts            # POST track item endpoint
│   ├── optimize/route.ts         # POST optimization endpoint
│   ├── unload/route.ts           # POST unload items endpoint
│   └── preload-cost/route.ts     # POST pre-load cost calculation
├── components/
│   ├── budget-meter.tsx          # Progress bar with status indicators
│   ├── budget-breakdown.tsx      # Pie chart visualization
│   ├── optimization-suggestions.tsx  # Actionable optimization UI
│   ├── context-items-list.tsx    # Item management list
│   └── budget-dashboard.tsx      # Main dashboard component
└── db/
    └── schema.ts                 # Database tables
```

### Database Schema

#### budget_tracking
Tracks overall token usage for each session.

```sql
CREATE TABLE budget_tracking (
  id UUID PRIMARY KEY,
  session_id VARCHAR(255) NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id),
  total_tokens INTEGER DEFAULT 128000,
  used_tokens INTEGER DEFAULT 0,
  remaining_tokens INTEGER DEFAULT 128000,
  usage_percentage INTEGER DEFAULT 0,
  is_warning BOOLEAN DEFAULT false,
  is_critical BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### context_items
Stores individual context items and their metadata.

```sql
CREATE TABLE context_items (
  id UUID PRIMARY KEY,
  session_id VARCHAR(255) NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  type VARCHAR(50) NOT NULL,  -- 'skill', 'file', 'message', 'tool', 'baseline', 'history'
  name VARCHAR(255) NOT NULL,
  token_cost INTEGER NOT NULL,
  priority VARCHAR(20) NOT NULL,  -- 'critical', 'high', 'medium', 'low'
  status VARCHAR(20) DEFAULT 'loaded',  -- 'loaded', 'unloaded', 'pending', 'failed'
  last_accessed_at TIMESTAMP,
  access_count INTEGER DEFAULT 0,
  metadata JSONB,
  loaded_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### budget_events
Historical log of budget changes.

```sql
CREATE TABLE budget_events (
  id UUID PRIMARY KEY,
  session_id VARCHAR(255) NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  event_type VARCHAR(50) NOT NULL,  -- 'load', 'unload', 'threshold_reached', 'optimization_applied'
  item_id UUID REFERENCES context_items(id),
  token_delta INTEGER NOT NULL,
  budget_snapshot JSONB NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### budget_configurations
User-specific budget preferences.

```sql
CREATE TABLE budget_configurations (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES users(id),
  total_tokens INTEGER DEFAULT 128000,
  warning_threshold INTEGER DEFAULT 80,  -- Percentage
  critical_threshold INTEGER DEFAULT 95,  -- Percentage
  auto_unload_enabled BOOLEAN DEFAULT true,
  auto_unload_min_access_count INTEGER DEFAULT 1,
  auto_unload_min_time_ms INTEGER DEFAULT 300000,  -- 5 minutes
  compression_enabled BOOLEAN DEFAULT true,
  auto_compress BOOLEAN DEFAULT false,
  compression_threshold INTEGER DEFAULT 2000,  -- Tokens
  category_preferences JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

## API Reference

### GET /api/context/budget

Get current budget status for a session.

**Query Parameters:**
- `sessionId` (required): Session identifier
- `userId` (required): User identifier
- `includeHistory` (optional): Include budget event history
- `includeSuggestions` (optional): Include optimization suggestions

**Response:**
```json
{
  "success": true,
  "budget": {
    "total": 128000,
    "used": 5000,
    "remaining": 123000,
    "usagePercentage": 4,
    "isWarning": false,
    "isCritical": false,
    "allocations": [...]
  },
  "items": [...],
  "suggestions": [...],
  "history": [...]
}
```

### POST /api/context/track

Track a context item (load, unload, or access).

**Request Body:**
```json
{
  "sessionId": "session-123",
  "userId": "user-456",
  "action": "load",
  "item": {
    "type": "skill",
    "name": "Test-Driven Development",
    "tokenCost": 2000,
    "priority": "high",
    "metadata": {
      "skillId": "mandatory-tdd"
    }
  }
}
```

**Response:**
```json
{
  "success": true,
  "item": {...},
  "budget": {...},
  "warnings": []
}
```

### POST /api/context/optimize

Get optimization suggestions.

**Request Body:**
```json
{
  "sessionId": "session-123",
  "userId": "user-456",
  "aggressiveness": "moderate",
  "targetReduction": 5000
}
```

**Response:**
```json
{
  "success": true,
  "suggestions": [
    {
      "type": "unload",
      "priority": "high",
      "description": "Unload 3 rarely accessed items",
      "estimatedSavings": 5000,
      "confidence": 0.9,
      "affectedItems": [...]
    }
  ],
  "estimatedSavings": 5000,
  "currentUsage": 50000,
  "targetUsage": 45000
}
```

### POST /api/context/unload

Unload one or more context items.

**Request Body:**
```json
{
  "sessionId": "session-123",
  "userId": "user-456",
  "itemIds": ["item-1", "item-2"],
  "reason": "manual_unload"
}
```

**Response:**
```json
{
  "success": true,
  "unloadedItems": [...],
  "budget": {...},
  "tokensSaved": 8000
}
```

### POST /api/context/preload-cost

Calculate the cost of loading an item before actually loading it.

**Request Body:**
```json
{
  "sessionId": "session-123",
  "userId": "user-456",
  "item": {
    "type": "file",
    "name": "large-file.ts",
    "tokenCost": 10000,
    "priority": "medium"
  }
}
```

**Response:**
```json
{
  "success": true,
  "preLoadCost": {
    "canLoad": false,
    "estimatedCost": 10000,
    "reason": "Insufficient budget",
    "suggestedUnloads": [...],
    "budgetAfterLoad": {
      "used": 60000,
      "remaining": 68000,
      "usagePercentage": 47
    }
  }
}
```

## Usage Examples

### React Component Usage

```tsx
import { BudgetDashboard } from '@/components/context-budget';

export function MyPage() {
  const sessionId = 'session-123';
  const userId = 'user-456';

  return (
    <div>
      <h1>Token Budget Management</h1>
      <BudgetDashboard
        sessionId={sessionId}
        userId={userId}
        autoRefresh={true}
        refreshInterval={10000}
      />
    </div>
  );
}
```

### Service Usage

```typescript
import { contextBudgetService } from '@/lib/services/context-budget.service';

// Get current budget
const budget = await contextBudgetService.getBudget(sessionId, userId);
console.log(`Used: ${budget.used}/${budget.total} tokens`);

// Track loading an item
const result = await contextBudgetService.trackItem(
  sessionId,
  userId,
  {
    type: 'skill',
    name: 'Git Workflow',
    tokenCost: 1500,
    priority: 'high',
  },
  'load'
);

// Get optimization suggestions
const suggestions = await contextBudgetService.getOptimizationSuggestions(
  sessionId,
  userId,
  'moderate'
);

// Make a loading decision
const decision = await contextBudgetService.makeLoadingDecision(
  sessionId,
  userId,
  {
    type: 'file',
    name: 'components.tsx',
    tokenCost: 5000,
    priority: 'medium',
  }
);

if (decision.shouldLoad) {
  // Safe to load
} else if (decision.itemsToUnload) {
  // Need to unload these items first
} else if (decision.alternatives?.useCompressed) {
  // Load compressed version instead
}
```

## Smart Loading Algorithm

The smart loading system uses a priority-based algorithm:

1. **Calculate Priority Score**
   - Base score from priority level (critical=100, high=75, medium=50, low=25)
   - Adjust for budget state (penalty in warning/critical states)
   - Add type importance bonus (baseline=20, skill=15, tool=10, file=5, message=3, history=1)
   - Penalize expensive items (>5000 tokens)

2. **Check Budget Availability**
   - If sufficient budget, approve immediately
   - If insufficient, check for auto-unload candidates

3. **Find Unload Candidates**
   - Sort by priority (low first) and last access time (old first)
   - Skip critical items
   - Check eligibility (access count, time since access, priority)
   - Select until enough tokens are freed

4. **Suggest Alternatives**
   - Compressed version for large files
   - Metadata-only loading for skills
   - Deferred loading for low-priority items

## Optimization Strategies

### 1. Unload Rarely Used Items
- Confidence: 90%
- Target: Items with access_count ≤ threshold
- Excludes: Critical priority items

### 2. Compress Large Files
- Confidence: 75%
- Target: Files > compression_threshold tokens
- Estimated savings: 60% of original size

### 3. Summarize Old Messages
- Confidence: 80%
- Target: Messages > 10 minutes old
- Estimated savings: 70% of original size

### 4. Consolidate Similar Skills
- Confidence: 60%
- Target: Multiple skills in same category
- Estimated savings: 30% of total

## Budget Thresholds

### Warning State (80%)
- Display yellow indicator
- Show warning message
- Continue normal operation

### Critical State (95%)
- Display red indicator
- Show critical alert
- Auto-unload low-priority items (if enabled)
- Block loading of non-critical items

## Testing

Run the test suite:

```bash
# Run all tests
pnpm test

# Run with coverage
pnpm test:coverage

# Watch mode
pnpm test:watch

# Specific test file
pnpm test context-budget
```

Expected coverage: 80%+ across all metrics.

## Performance Targets

- Token calculation: <10ms
- Budget updates: <50ms
- Optimization analysis: <200ms
- UI refresh: <100ms
- Compression operations: <500ms

## Future Enhancements

### Phase 4: Compression Engine (Week 3)
- File summarization
- Metadata-only skill loading
- Message compression
- Output summarization

### Phase 5: Advanced Optimization (Week 3)
- Unused item detection
- Smart auto-unload
- Compression recommendations
- Usage forecasting
- Pattern analysis

### Phase 6: Team Features (Week 4)
- Budget profiles
- Team analytics
- Optimization tips
- Notifications (Slack/email)
- Report exports

## Troubleshooting

### Budget Not Updating
- Check session ID consistency
- Verify database connection
- Check for API errors in console

### Items Not Unloading
- Verify item is not critical priority
- Check auto_unload_enabled setting
- Ensure item exists and is loaded

### Optimization Suggestions Empty
- Verify items are loaded
- Check configuration thresholds
- Ensure sufficient usage data

## Support

For issues or questions:
- GitHub Issues: https://github.com/AINative-Studio/builder-ainative-studio/issues
- Documentation: /docs/context-budget-manager.md
- Example Usage: /components/context-budget/budget-dashboard.tsx
