# Chunking Architecture for Complex Applications

## Overview

Break complex multi-page applications into manageable chunks that can be generated reliably within the 8,000-12,000 token sweet spot, then intelligently merge them together.

## Architecture Diagram

```
User PRD Input
      ↓
[PRD Analyzer]
      ↓
Complexity Assessment → Simple (1-5 pages)? → Single Pass Generation → Done
      ↓
Complex (6+ pages)
      ↓
[Chunk Planner]
      ↓
Phase 1: Core Structure (6-8k tokens)
  - Layout components
  - Routing setup
  - Global state (Zustand/Context)
  - Mock data models
  - Type definitions
      ↓
Phase 2: Feature Chunks (4-6k tokens each)
  - Chunk 1: Auth + Dashboard
  - Chunk 2: Products + Categories
  - Chunk 3: Orders + Customers
  - Chunk 4: Settings + Profile
      ↓
Phase 3: Integration & Polish (2-3k tokens)
  - Connect all chunks
  - Final validation
  - Cross-chunk navigation
      ↓
[Chunk Merger]
      ↓
Single Cohesive Application
```

## Phase 1: Core Structure

**Goal**: Generate the foundational architecture that all features will plug into.

**Generated Files**:
```
app/
  layout.tsx          # Root layout with providers
  providers.tsx       # Context/Zustand providers
lib/
  store.ts           # Global Zustand store
  types.ts           # TypeScript interfaces
  mockData.ts        # Mock data models
components/
  layout/
    Sidebar.tsx      # Navigation sidebar
    Header.tsx       # Top header
    Layout.tsx       # Main layout wrapper
```

**Prompt Template**:
```
Generate the CORE STRUCTURE ONLY for a {app_description}.

Include:
1. Root layout with sidebar and header
2. Global Zustand store setup
3. TypeScript type definitions for: {list_data_models}
4. Mock data generators for: {list_data_models}
5. Empty route placeholders for: {list_all_routes}

DO NOT implement page content yet. Focus on structure and routing.
Target: 6,000-8,000 tokens.
```

## Phase 2: Feature Chunks

**Goal**: Generate each feature module as a standalone piece that plugs into the core structure.

**Chunking Strategy**:
- Group related pages together (e.g., Products + Categories)
- Each chunk should be 4,000-6,000 tokens
- Include all components, hooks, and utilities for that feature

**Chunk Example - Products Module**:
```
app/
  products/
    page.tsx           # Product list
    [id]/
      page.tsx         # Product detail
      edit/
        page.tsx       # Edit product
    categories/
      page.tsx         # Categories
    new/
      page.tsx         # Add product
components/
  products/
    ProductCard.tsx
    ProductForm.tsx
    CategoryList.tsx
```

**Prompt Template**:
```
Generate the {feature_name} module for the application.

Context from Phase 1:
- Available types: {types_from_phase1}
- Global store: {store_structure}
- Mock data: {mock_data_functions}

Implement:
1. All pages for {feature_name}: {list_pages}
2. Feature-specific components
3. Feature-specific hooks (if needed)
4. Use existing types and mock data from Phase 1

Assume routing and layout already exist.
Target: 4,000-6,000 tokens.
```

## Phase 3: Integration & Polish

**Goal**: Connect all chunks, add cross-chunk features, final validation.

**Integration Tasks**:
1. Cross-module navigation (e.g., "View Order" button in Products)
2. Shared components used across chunks
3. Final state management connections
4. Error boundaries
5. Loading states

**Prompt Template**:
```
INTEGRATION PASS for the complete application.

Existing modules:
{list_all_generated_chunks}

Tasks:
1. Add cross-module navigation links
2. Ensure consistent data flow between modules
3. Add global error handling
4. Add loading states for all async operations
5. Final polish and validation

Target: 2,000-3,000 tokens.
```

## Chunk Merger Algorithm

```typescript
interface GeneratedChunk {
  phase: 1 | 2 | 3
  chunkId: string
  code: string
  files: Map<string, string>  // filepath -> content
  dependencies: string[]       // other chunk IDs this depends on
}

function mergeChunks(chunks: GeneratedChunk[]): string {
  // 1. Start with Phase 1 (core structure)
  const coreStructure = chunks.find(c => c.phase === 1)
  const mergedFiles = new Map(coreStructure.files)

  // 2. Merge Phase 2 chunks (features)
  const featureChunks = chunks.filter(c => c.phase === 2)
  for (const chunk of featureChunks) {
    for (const [filepath, content] of chunk.files) {
      // If file exists, merge imports
      if (mergedFiles.has(filepath)) {
        mergedFiles.set(filepath, mergeImports(
          mergedFiles.get(filepath),
          content
        ))
      } else {
        mergedFiles.set(filepath, content)
      }
    }
  }

  // 3. Apply Phase 3 (integration)
  const integration = chunks.find(c => c.phase === 3)
  if (integration) {
    for (const [filepath, content] of integration.files) {
      mergedFiles.set(filepath, content)  // Override with final version
    }
  }

  // 4. Combine all files into single output
  return combineFiles(mergedFiles)
}
```

## PRD Analysis for Chunking

**Complexity Metrics**:
- Page count: 1-5 = Simple, 6-10 = Medium, 11+ = Complex
- Feature count: 1-3 = Simple, 4-7 = Medium, 8+ = Complex
- State complexity: Local only = Simple, Zustand = Medium, Zustand + Forms = Complex

**Decision Matrix**:
| Pages | Features | Chunking Strategy |
|-------|----------|-------------------|
| 1-5   | 1-3      | Single pass (no chunking) |
| 6-10  | 4-7      | 3 phases: Core + 2-3 feature chunks + Integration |
| 11-15 | 8-12     | 3 phases: Core + 4-6 feature chunks + Integration |
| 16+   | 13+      | 3 phases: Core + 7+ feature chunks + Integration |

## Implementation Steps

1. **Enhance PRD Analyzer** (`lib/agent/prd-analyzer.ts`)
   - Add complexity scoring
   - Add chunking recommendations
   - Add chunk breakdown logic

2. **Create Chunk Planner** (`lib/agent/chunk-planner.ts`)
   - Takes PRD analysis
   - Generates phase-by-phase prompts
   - Returns chunk plan with dependencies

3. **Create Multi-Pass Generator** (`lib/agent/multi-pass-generator.ts`)
   - Executes chunk plan
   - Generates each chunk separately
   - Tracks dependencies

4. **Create Chunk Merger** (`lib/agent/chunk-merger.ts`)
   - Merges all generated chunks
   - Resolves import conflicts
   - Validates final output

5. **Update Chat API** (`app/api/chat-ws/route.ts`)
   - Detect complex PRD
   - Use multi-pass generator instead of single-pass
   - Stream progress for each chunk

## Example: Bay View Chunked

**Phase 1: Core Structure** (8,000 tokens)
- Layout with sidebar
- Zustand store for currentArticle, isPlaying, activeView
- Types: Article, Podcast, SearchResult
- Mock data generators

**Phase 2a: Content Pages** (5,000 tokens)
- Homepage
- Article page with audio player

**Phase 2b: Discovery** (4,500 tokens)
- Podcast hub
- Archive search

**Phase 2c: Engagement** (4,000 tokens)
- Chat modal with voice
- Subscription page

**Phase 3: Integration** (2,500 tokens)
- Cross-page navigation
- Shared audio player state
- Native ad integration
- Final polish

**Total**: ~24,000 tokens across 5 passes
**Each pass**: Within 8k token sweet spot
**Success rate**: ~90% (vs 0% for single pass)

## Testing Strategy

1. Test with Bay View (7 pages → 4 chunks)
2. Test with GBOS (20+ pages → 7 chunks)
3. Measure success rate per chunk
4. Measure merge success rate
5. Compare to single-pass baseline

## Success Metrics

- **Chunk generation success**: >95% per chunk
- **Merge success**: >90% after all chunks combined
- **Overall success**: >85% for complex apps
- **Time to complete**: 3-5x single pass time (acceptable tradeoff)
- **Token efficiency**: 70-80% (some overlap between chunks)

## Rollout Plan

1. **Week 1**: Implement core chunking logic
2. **Week 2**: Test with Bay View, refine merge algorithm
3. **Week 3**: Test with GBOS, handle edge cases
4. **Week 4**: Production rollout with A/B testing

---

This architecture enables generation of enterprise-scale applications while maintaining quality and success rate.
