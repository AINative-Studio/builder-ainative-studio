/**
 * Message role types for AI conversations
 */
export type MessageRole = 'user' | 'assistant' | 'system';

/**
 * Streaming state for messages
 */
export type StreamingState = 'idle' | 'streaming' | 'complete' | 'error';

/**
 * Animation type for rendering tokens
 */
export type AnimationType = 'none' | 'fade' | 'typewriter' | 'smooth';

/**
 * Code theme for syntax highlighting
 */
export type CodeTheme =
  | 'dark'
  | 'light'
  | 'vs-dark'
  | 'github'
  | 'monokai'
  | 'nord'
  | 'dracula';

/**
 * Message metadata
 */
export interface MessageMetadata {
  id?: string;
  timestamp?: Date;
  model?: string;
  tokensUsed?: number;
  [key: string]: unknown;
}

/**
 * Base message interface
 */
export interface Message {
  role: MessageRole;
  content: string;
  metadata?: MessageMetadata;
}

/**
 * Streaming message props
 */
export interface StreamingMessageProps {
  /** Message role (user, assistant, system) */
  role: MessageRole;

  /** Current message content (can be partial during streaming) */
  content: string;

  /** Streaming state */
  streamingState?: StreamingState;

  /** Animation type for new tokens */
  animationType?: AnimationType;

  /** Animation speed in milliseconds per character (for typewriter effect) */
  animationSpeed?: number;

  /** Enable markdown rendering */
  enableMarkdown?: boolean;

  /** Code syntax highlighting theme */
  codeTheme?: CodeTheme;

  /** Show streaming indicator (typing dots) */
  showStreamingIndicator?: boolean;

  /** Custom CSS class name */
  className?: string;

  /** Custom styles */
  style?: React.CSSProperties;

  /** Avatar URL or element for the message sender */
  avatar?: string | React.ReactNode;

  /** Display name for the message sender */
  displayName?: string;

  /** Show timestamp */
  showTimestamp?: boolean;

  /** Message metadata */
  metadata?: MessageMetadata;

  /** Callback when streaming completes */
  onStreamingComplete?: () => void;

  /** Callback when content updates */
  onContentUpdate?: (content: string) => void;

  /** Custom error handler */
  onError?: (error: Error) => void;

  /** Enable copy button for code blocks */
  enableCodeCopy?: boolean;

  /** Custom role colors */
  roleColors?: {
    user?: string;
    assistant?: string;
    system?: string;
  };

  /** Test ID for testing */
  testId?: string;
}

/**
 * Streaming indicator props
 */
export interface StreamingIndicatorProps {
  /** Indicator style */
  variant?: 'dots' | 'pulse' | 'wave';

  /** Custom CSS class name */
  className?: string;

  /** Custom styles */
  style?: React.CSSProperties;

  /** Test ID for testing */
  testId?: string;
}

/**
 * Code block props
 */
export interface CodeBlockProps {
  /** Programming language */
  language: string;

  /** Code content */
  children: string;

  /** Syntax highlighting theme */
  theme?: CodeTheme;

  /** Enable copy button */
  enableCopy?: boolean;

  /** Custom CSS class name */
  className?: string;

  /** Show line numbers */
  showLineNumbers?: boolean;
}
