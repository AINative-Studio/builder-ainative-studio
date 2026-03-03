/**
 * Agent Skill System Types
 *
 * Defines types for a modular, progressive-disclosure skill system
 * that allows agents to load specialized knowledge on-demand.
 *
 * Based on .claude/skills pattern which achieved 82% token reduction.
 */

export interface SkillMetadata {
  /** Unique identifier for the skill */
  id: string;

  /** Display name for the skill */
  name: string;

  /** Short description (~100 words) shown in autocomplete and skill browser */
  description: string;

  /** Version of the skill (semver) */
  version: string;

  /** Author information */
  author: {
    id: string;
    name: string;
    email?: string;
  };

  /** Tags for categorization and search */
  tags: string[];

  /** When this skill should auto-load */
  triggerPatterns?: string[];

  /** Other skills this one depends on */
  dependencies?: string[];

  /** Token cost estimation */
  tokenCost: {
    metadata: number;  // Cost to load metadata only (~100 tokens)
    full: number;      // Cost to load full skill content (~2000 tokens)
  };

  /** Compatibility requirements */
  compatibility?: {
    frameworks?: string[];  // e.g., ['next.js', 'react']
    languages?: string[];   // e.g., ['typescript', 'python']
    minVersion?: string;    // Minimum builder version
  };

  /** Creation and update timestamps */
  createdAt: Date;
  updatedAt: Date;
}

export interface SkillReference {
  /** Reference name (e.g., "BDD Patterns") */
  name: string;

  /** Path to reference file or URL */
  path: string;

  /** Type of reference */
  type: 'markdown' | 'code' | 'url' | 'example';

  /** Optional description */
  description?: string;
}

export interface SkillExample {
  /** Example title */
  title: string;

  /** Example code or text */
  content: string;

  /** Programming language for syntax highlighting */
  language?: string;

  /** Additional context */
  description?: string;
}

export interface AgentSkill {
  /** Metadata (always loaded) */
  metadata: SkillMetadata;

  /** Full skill content (markdown, loaded on-demand) */
  content: string;

  /** Reference documents (loaded only when accessed) */
  references?: SkillReference[];

  /** Code examples (loaded only when accessed) */
  examples?: SkillExample[];

  /** Validation rules the skill enforces */
  validationRules?: string[];

  /** Commands this skill provides */
  commands?: string[];
}

export interface SkillLoadState {
  /** Skill ID */
  skillId: string;

  /** Is metadata loaded */
  metadataLoaded: boolean;

  /** Is full content loaded */
  contentLoaded: boolean;

  /** Are references loaded */
  referencesLoaded: boolean;

  /** When was it loaded */
  loadedAt?: Date;

  /** Time to load (ms) */
  loadTime?: number;
}

export interface SkillTrigger {
  /** Pattern that triggered the skill */
  pattern: string;

  /** Regex or simple string match */
  matchType: 'regex' | 'string' | 'semantic';

  /** Context where trigger applies */
  context?: 'commit' | 'file-create' | 'file-edit' | 'chat' | 'pr-create';

  /** Priority (higher = load first) */
  priority?: number;
}

export interface SkillContext {
  /** Current conversation/session ID */
  sessionId: string;

  /** User ID */
  userId: string;

  /** Project ID */
  projectId?: string;

  /** Current file being edited */
  currentFile?: string;

  /** Recent user messages */
  recentMessages?: string[];

  /** Git context */
  gitContext?: {
    branch: string;
    hasUncommittedChanges: boolean;
    lastCommitMessage?: string;
  };

  /** Token budget remaining */
  tokenBudget?: {
    total: number;
    used: number;
    remaining: number;
  };
}

export interface SkillRecommendation {
  /** Recommended skill */
  skill: SkillMetadata;

  /** Why it's recommended */
  reason: string;

  /** Confidence score (0-1) */
  confidence: number;

  /** Should auto-load or prompt user? */
  autoLoad: boolean;
}

export interface SkillUsageStats {
  /** Skill ID */
  skillId: string;

  /** Times loaded */
  loadCount: number;

  /** Times triggered automatically */
  autoTriggerCount: number;

  /** Times manually invoked */
  manualInvokeCount: number;

  /** Average load time (ms) */
  avgLoadTime: number;

  /** User ratings */
  rating?: {
    average: number;
    count: number;
  };

  /** Last used timestamp */
  lastUsedAt?: Date;
}

export interface SkillCollection {
  /** Collection ID */
  id: string;

  /** Collection name */
  name: string;

  /** Collection description */
  description: string;

  /** Skills in this collection */
  skillIds: string[];

  /** Is this a built-in collection */
  isBuiltIn: boolean;

  /** Is this a team collection */
  isTeam: boolean;

  /** Team/organization ID if team collection */
  teamId?: string;
}

export interface SkillSearchQuery {
  /** Search text */
  query?: string;

  /** Filter by tags */
  tags?: string[];

  /** Filter by author */
  authorId?: string;

  /** Filter by framework compatibility */
  frameworks?: string[];

  /** Filter by language compatibility */
  languages?: string[];

  /** Minimum rating */
  minRating?: number;

  /** Sort order */
  sortBy?: 'relevance' | 'downloads' | 'rating' | 'recent' | 'name';

  /** Pagination */
  limit?: number;
  offset?: number;
}

export interface SkillSearchResult {
  /** Matching skills */
  skills: SkillMetadata[];

  /** Total count */
  total: number;

  /** Search took (ms) */
  searchTime: number;
}

// Export types for React components
export type SkillBrowserProps = {
  onSkillSelect: (skill: AgentSkill) => void;
  currentContext?: SkillContext;
};

export type SkillEditorProps = {
  skill?: AgentSkill;
  onSave: (skill: AgentSkill) => Promise<void>;
  onCancel: () => void;
};

export type SkillStatusProps = {
  loadedSkills: SkillLoadState[];
  tokenBudget: {
    total: number;
    used: number;
    remaining: number;
  };
};
