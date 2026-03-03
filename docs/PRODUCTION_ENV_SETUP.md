# Production Environment Variables Setup

This guide provides the complete configuration needed for deploying builder.ainative.studio to production on Vercel.

## Required Environment Variables

### Core Application Configuration

```bash
# Application Environment
NODE_ENV=production
NEXT_PUBLIC_APP_URL=https://builder.ainative.studio

# Authentication & Security
# Generate with: openssl rand -base64 32
AUTH_SECRET=<your-generated-secret>
```

### Database Configuration

```bash
# PostgreSQL Database (Vercel Postgres recommended)
POSTGRES_URL=<vercel-postgres-url>
DATABASE_URL=<vercel-postgres-url>
```

### Redis Configuration

```bash
# Upstash Redis (for Edge Runtime - rate limiting)
# Required for middleware rate limiting
UPSTASH_REDIS_REST_URL=<upstash-redis-rest-url>
UPSTASH_REDIS_REST_TOKEN=<upstash-redis-rest-token>

# Standard Redis (for session management and caching)
REDIS_URL=<redis-url>
REDIS_TTL=86400
```

### AI/ML Service APIs

```bash
# Anthropic API (Primary AI Service)
ANTHROPIC_API_KEY=<your-anthropic-api-key>
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
USE_SUBAGENTS=true

# Meta LLAMA API (Alternative AI Service)
META_API_KEY=<your-meta-api-key>
META_BASE_URL=https://api.llama.com/compat/v1
LLAMA_MODEL=Llama-4-Maverick-17B-128E-Instruct-FP8

# OpenAI API (for embeddings and translation)
OPENAI_API_KEY=<your-openai-api-key>

# DeepL API (optional - alternative translator)
DEEPL_API_KEY=<your-deepl-api-key>
```

### ZeroDB MCP Configuration

```bash
# ZeroDB for CRUD UI generation features
ZERODB_MCP_URL=https://mcp.zerodb.io
ZERODB_MCP_API_KEY=<your-zerodb-api-key>
ZERODB_PROJECT_ID=<your-zerodb-project-id>
```

### Rate Limiting

```bash
# Maximum chats per user per hour
MAX_CHATS_PER_HOUR=50

# Maximum chats per IP for anonymous users per hour
MAX_ANONYMOUS_CHATS_PER_HOUR=10
```

### Deployment Credentials Encryption

```bash
# 256-bit encryption key for storing deployment API tokens (AES-256-GCM)
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
DEPLOYMENT_ENCRYPTION_KEY=<your-encryption-key>
```

### Monitoring & Logging

```bash
# Log level: debug, info, warn, error
LOG_LEVEL=info

# Sentry DSN (optional - for error tracking)
SENTRY_DSN=<your-sentry-dsn>
```

## Vercel-Specific Variables

These are automatically set by Vercel:

```bash
VERCEL=1
VERCEL_ENV=production
VERCEL_URL=builder.ainative.studio
VERCEL_REGION=iad1
```

## Setting Up Environment Variables in Vercel

### Via Vercel Dashboard

1. Go to your project in Vercel Dashboard
2. Navigate to Settings > Environment Variables
3. Add each variable with the appropriate scope:
   - **Production**: Required for production deployments
   - **Preview**: Optional for preview deployments
   - **Development**: Not needed (use local .env)

### Via Vercel CLI

```bash
# Install Vercel CLI
npm i -g vercel

# Set production environment variables
vercel env add POSTGRES_URL production
vercel env add AUTH_SECRET production
vercel env add ANTHROPIC_API_KEY production
# ... repeat for all required variables

# Pull environment variables for local development
vercel env pull .env.local
```

### Required Variables Checklist

Use this checklist to ensure all required variables are set:

- [ ] `NODE_ENV=production`
- [ ] `NEXT_PUBLIC_APP_URL=https://builder.ainative.studio`
- [ ] `AUTH_SECRET` (generated)
- [ ] `POSTGRES_URL` (Vercel Postgres)
- [ ] `DATABASE_URL` (Vercel Postgres)
- [ ] `UPSTASH_REDIS_REST_URL` (Upstash)
- [ ] `UPSTASH_REDIS_REST_TOKEN` (Upstash)
- [ ] `REDIS_URL` (Redis instance)
- [ ] `ANTHROPIC_API_KEY`
- [ ] `ANTHROPIC_MODEL`
- [ ] `USE_SUBAGENTS=true`
- [ ] `META_API_KEY`
- [ ] `OPENAI_API_KEY`
- [ ] `ZERODB_MCP_API_KEY`
- [ ] `ZERODB_PROJECT_ID`
- [ ] `DEPLOYMENT_ENCRYPTION_KEY` (generated)
- [ ] `MAX_CHATS_PER_HOUR`
- [ ] `MAX_ANONYMOUS_CHATS_PER_HOUR`
- [ ] `LOG_LEVEL=info`

### Optional Variables

- [ ] `DEEPL_API_KEY` (alternative translator)
- [ ] `SENTRY_DSN` (error tracking)

## Security Best Practices

1. **Never commit `.env` files** - They are in `.gitignore`
2. **Use strong, randomly generated secrets** - Especially for `AUTH_SECRET` and `DEPLOYMENT_ENCRYPTION_KEY`
3. **Rotate credentials regularly** - Especially API keys with broad permissions
4. **Use separate credentials per environment** - Never reuse production credentials in development
5. **Enable API key restrictions** - Where supported by the provider (IP restrictions, domain restrictions)
6. **Monitor API usage** - Set up alerts for unusual activity
7. **Use Vercel's environment variable encryption** - All secrets are encrypted at rest

## Validation

After setting all variables, validate your configuration:

```bash
# Test database connection
vercel env pull .env.production.local
npx tsx scripts/validate-env.ts

# Deploy to preview first
vercel --prod=false

# Test preview deployment
curl https://your-preview-url.vercel.app/api/health

# Deploy to production
vercel --prod
```

## Troubleshooting

### Database Connection Issues

- Ensure `POSTGRES_URL` and `DATABASE_URL` are identical
- Verify your IP is allowed in Vercel Postgres settings
- Check SSL mode requirements (`?sslmode=require`)

### Redis Connection Issues

- For Edge Runtime (middleware), use Upstash Redis REST API
- For Node.js runtime (API routes), you can use standard Redis
- Ensure both `UPSTASH_REDIS_REST_URL` and `REDIS_URL` are set

### API Key Issues

- Verify API keys are active and have sufficient quota
- Check for IP restrictions or domain restrictions
- Monitor rate limits and usage quotas

### Build Failures

- Check build logs in Vercel Dashboard
- Verify all required environment variables are set
- Ensure database migrations run successfully

## Monitoring Setup

The application includes built-in monitoring for:

- **Token Usage Tracking**: All AI API calls are logged with token counts
- **Generation Time Metrics**: Response times are tracked per generation
- **Error Logging**: All errors are persisted to `error_logs` table
- **Request Metrics**: API endpoints log performance data

Access monitoring data via:

- `/api/admin/errors` - Error logs (admin only)
- `/api/usage` - Token usage statistics
- Database queries on `error_logs` and `generations` tables

## Support

For issues with environment variable setup:

1. Check Vercel deployment logs
2. Verify environment variables in Vercel Dashboard
3. Test with preview deployment first
4. Review error logs at `/api/admin/errors`
