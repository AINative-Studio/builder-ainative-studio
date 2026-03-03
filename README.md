# AINative Component Builder

> **Production Ready**: AI-powered React component builder using Anthropic Claude Sonnet 4 in a hierarchical multi-agent system

<p align="center">
    <img src="./screenshot.png" alt="AINative Component Builder Screenshot" width="800" />
</p>

<p align="center">
    Build production-ready React components using AI-powered agents with Claude Sonnet 4
</p>

<p align="center">
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#deploy-your-own"><strong>Deploy Your Own</strong></a> ·
  <a href="#setup"><strong>Setup</strong></a> ·
  <a href="#getting-started"><strong>Getting Started</strong></a> ·
  <a href="#architecture"><strong>Architecture</strong></a>
</p>
<br/>

## Deploy Your Own

You can deploy your own version of AINative Component Builder to Vercel with one click:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FAINative-Studio%2Fbuilder-ainative-studio&env=DATABASE_URL,AUTH_SECRET,ANTHROPIC_API_KEY&envDescription=Required+environment+variables&envLink=https%3A%2F%2Fgithub.com%2FAINative-Studio%2Fbuilder-ainative-studio%23environment-variables&project-name=builder-ainative-studio&repository-name=builder-ainative-studio&demo-title=AINative+Component+Builder&demo-description=AI-powered+React+component+builder+using+Anthropic+Claude+Sonnet+4&skippable-integrations=1)

## Features

### AI-Powered Generation System

- **Hierarchical Multi-Agent Architecture**: 4-tier agent system (Orchestrator + 3 specialized subagents)
  - **Design Subagent**: Analyzes requirements and creates design specifications
  - **Code Subagent**: Generates React components from design specs
  - **Validation Subagent**: Tests and validates generated code
- **Anthropic Claude Sonnet 4**: Primary model (claude-sonnet-4-20250514) with extended thinking
- **Extended Thinking**: 2000-token thinking budget for improved quality and reasoning
- **Template System**: 35 predefined templates with semantic matching
- **Custom Prompt Support**: Full support for custom component generation from natural language
- **Memory System**: Anthropic Memory API for cross-conversation context persistence

### Core Features

- **Real-time Preview**: Split-screen interface with chat and live preview panels
- **Streaming Support**: Real-time AI response streaming with visual feedback
- **Image Integration**: Unsplash API integration for component imagery
- **Conversation History**: Maintains chat history throughout the session
- **Suggestion System**: Helpful prompts to guide users

### Authentication & Multi-Tenant Features

- **Anonymous Access**: Create chats without registration (with rate limits)
- **Guest Access**: Temporary accounts for persistent sessions
- **User Registration/Login**: Email/password authentication with secure password hashing
- **Session Management**: Secure session handling with NextAuth.js
- **Multi-Tenant Architecture**: Multiple users with isolated data
- **Ownership Mapping**: Users only see their own chats and projects
- **Rate Limiting**: Different limits for anonymous, guest, and registered users

## Setup

### Prerequisites

- Node.js 18+ and pnpm
- PostgreSQL database
- Anthropic API key ([Get one here](https://console.anthropic.com/))

### Environment Variables

Create a `.env` file with all required variables:

```bash
# Auth Secret - Generate a random string for production
# Generate with: openssl rand -base64 32
# Or visit: https://generate-secret.vercel.app/32
AUTH_SECRET=your-auth-secret-here

# Database URL - PostgreSQL connection string
DATABASE_URL=postgresql://user:password@localhost:5432/ainative_db
POSTGRES_URL=postgresql://user:password@localhost:5432/ainative_db

# Anthropic API Key - Get from https://console.anthropic.com/
ANTHROPIC_API_KEY=your-anthropic-api-key-here

# Anthropic Model Configuration
ANTHROPIC_MODEL=claude-sonnet-4-20250514

# OpenAI API Key (for embeddings and utilities only)
OPENAI_API_KEY=your-openai-api-key-here

# Unsplash API Key (for image integration)
UNSPLASH_ACCESS_KEY=your-unsplash-access-key

# Subagents Configuration
USE_SUBAGENTS=true  # Enable hierarchical multi-agent system
```

### Database Setup

This project uses PostgreSQL with Drizzle ORM. Set up your database:

1. **Generate Database Schema**:
   ```bash
   pnpm db:generate
   ```

2. **Run Database Migrations**:
   ```bash
   pnpm db:migrate
   ```

3. **Optional - Open Database Studio**:
   ```bash
   pnpm db:studio
   ```

## Getting Started

1. **Install Dependencies**:
   ```bash
   pnpm install
   ```

2. **Set Up Environment**:
   - Copy `.env.example` to `.env`
   - Add your Anthropic API key
   - Configure database connection

3. **Run Database Migrations**:
   ```bash
   pnpm db:migrate
   ```

4. **Start Development Server**:
   ```bash
   pnpm dev
   ```

5. **Open Application**:
   Open [http://localhost:3000](http://localhost:3000) to start building components

## Architecture

### Multi-Agent System

```
┌─────────────────────────────────────┐
│   Orchestrator Agent (Cody)        │
│   - Team leader                     │
│   - Coordinates workflow            │
│   - 30 years of experience          │
└────────────┬────────────────────────┘
             │
     ┌───────┴────────┬──────────────┐
     │                │               │
┌────▼────┐     ┌────▼─────┐    ┌───▼──────┐
│ Design  │     │   Code   │    │Validation│
│Subagent │────▶│ Subagent │───▶│ Subagent │
└─────────┘     └──────────┘    └──────────┘
```

**Workflow**:
1. User enters prompt → Orchestrator analyzes request
2. Design Subagent creates component specification
3. Code Subagent generates React component code
4. Validation Subagent tests and validates output
5. Result streamed back to user in real-time

### Technology Stack

**Frontend**:
- Next.js 15 with App Router
- React 19
- Tailwind CSS
- Shadcn/ui Components
- Monaco Editor for code display
- Real-time preview rendering

**Backend**:
- Next.js API Routes
- Anthropic Claude Sonnet 4 API
- OpenAI API (embeddings only)
- WebSocket for real-time streaming
- Drizzle ORM + PostgreSQL
- NextAuth.js for authentication

**AI Integration**:
- Anthropic SDK for Claude integration
- Tool Use API for structured output
- Anthropic Memory API for context
- Extended thinking for quality
- Prompt caching (90% cost reduction)

### Database Schema

- **Users**: User accounts with authentication
- **ProjectOwnership**: Maps projects to users
- **ChatOwnership**: Maps chats to users
- **AnonymousChatLog**: Rate limiting for anonymous users

### Key Components

- `app/page.tsx` - Main UI with chat and preview
- `app/api/chat-ws/route.ts` - WebSocket endpoint for streaming
- `lib/agent/subagents.ts` - Multi-agent orchestration
- `lib/agent/orchestrator.ts` - Main orchestrator logic
- `components/ai-elements/` - AI UI components
- `components/shared/` - Shared UI components

## Database Commands

- `pnpm db:generate` - Generate migration files from schema changes
- `pnpm db:migrate` - Apply pending migrations
- `pnpm db:studio` - Open Drizzle Studio for database inspection
- `pnpm db:push` - Push schema changes directly (development only)

## Testing

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage

# Run specific test suites
pnpm test:unit
pnpm test:integration
```

## Security Features

- Password hashing with bcrypt-ts
- Secure session cookies with NextAuth.js
- CSRF protection
- SQL injection protection via Drizzle ORM
- User data isolation through ownership mapping
- Rate limiting for anonymous access

## User Types & Rate Limits

- **Anonymous Users**: No account, 3 chats/day, no persistence
- **Guest Users**: Auto-created accounts, 5 chats/day, session persistence
- **Registered Users**: Permanent accounts, 50 chats/day, full features

Rate limits reset every 24 hours.

## Model Configuration

### Primary Model
- **claude-sonnet-4-20250514**: Used for all component generation
- Extended thinking enabled (2000 tokens)
- Prompt caching for cost optimization

### Secondary Models (Utilities Only)
- **OpenAI text-embedding-ada-002**: Template similarity matching
- **OpenAI GPT-4**: Translation and utility functions (if configured)

## Agent Profiles

The system uses agent profiles from `~/.claude/agents/`:
- `cody-team-leader.md` - Orchestrator configuration
- `ai-product-architect.md` - Design subagent
- `frontend-ui-builder.md` - Code subagent
- `qa-bug-hunter.md` - Validation subagent

## Documentation

- [Implementation Plan](./docs/BUILDER_AINATIVE_STUDIO_IMPLEMENTATION_PLAN.md)
- [Quick Summary](./docs/QUICK_SUMMARY.md)
- [GitHub Setup](./docs/GITHUB_SETUP_COMPLETE.md)

## Contributing

Contributions are welcome! Please see the issues in the repository for tasks that need work.

## License

MIT License - see LICENSE file for details

---

**Built with AI by AINative Studio**

Powered by Anthropic Claude Sonnet 4 and Next.js
