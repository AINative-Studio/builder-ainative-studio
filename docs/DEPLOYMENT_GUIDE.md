# AINative Studio Deployment Guide

This comprehensive guide covers everything you need to deploy AINative Component Builder to production.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [Build Process](#build-process)
4. [Deployment to Vercel](#deployment-to-vercel)
5. [Alternative Platforms](#alternative-platforms)
6. [Post-Deployment Verification](#post-deployment-verification)
7. [Monitoring Setup](#monitoring-setup)
8. [Troubleshooting](#troubleshooting)
9. [Rollback Procedures](#rollback-procedures)

---

## Prerequisites

### Required Accounts and Services

Before deploying, ensure you have:

- **Node.js** 18.x or higher installed
- **pnpm** package manager (`npm install -g pnpm`)
- **PostgreSQL** database (or managed service like Vercel Postgres, Supabase, Railway)
- **Redis** instance (or Upstash Redis for serverless)
- **Anthropic API** account and API key ([Get here](https://console.anthropic.com/))
- **Vercel** account (recommended) or alternative platform account
- **Git** repository (GitHub, GitLab, or Bitbucket)

### API Keys Required

Gather these API keys before starting:

1. **Anthropic API Key** - Primary AI model
2. **OpenAI API Key** - For embeddings and utilities
3. **Unsplash Access Key** (optional) - Image integration
4. **Database Connection String** - PostgreSQL URL
5. **Redis URL** - For session management and caching
6. **Upstash Redis** (for Vercel Edge) - REST URL and token

---

## Environment Setup

### Step 1: Clone and Install

```bash
# Clone the repository
git clone https://github.com/YOUR_ORG/builder-ainative-studio.git
cd builder-ainative-studio

# Install dependencies
pnpm install
```

### Step 2: Configure Environment Variables

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Edit `.env` with your production values:

```bash
# ==================== Database Configuration ====================
# PostgreSQL connection string
POSTGRES_URL=postgresql://user:password@host:5432/database
DATABASE_URL=postgresql://user:password@host:5432/database

# ==================== Redis Configuration ====================
# Redis connection for state persistence
REDIS_URL=redis://username:password@host:port

# Upstash Redis for Edge Runtime (Vercel middleware)
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token-here

# ==================== Authentication & Security ====================
# Generate with: openssl rand -base64 32
AUTH_SECRET=your-32-character-random-secret-here

# ==================== AI/ML Service APIs ====================
# Anthropic API (Primary)
ANTHROPIC_API_KEY=sk-ant-your-key-here
ANTHROPIC_MODEL=claude-sonnet-4-20250514

# OpenAI API (Embeddings and utilities)
OPENAI_API_KEY=sk-your-openai-key-here

# Unsplash (Optional - Image integration)
UNSPLASH_ACCESS_KEY=your-unsplash-key

# ==================== Application Configuration ====================
NODE_ENV=production
NEXT_PUBLIC_APP_URL=https://your-domain.com

# ==================== Rate Limiting ====================
MAX_CHATS_PER_HOUR=50
MAX_ANONYMOUS_CHATS_PER_HOUR=5

# ==================== Monitoring & Logging ====================
LOG_LEVEL=info
SENTRY_DSN=your-sentry-dsn (optional)

# ==================== Deployment Encryption ====================
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
DEPLOYMENT_ENCRYPTION_KEY=your-64-character-hex-key
```

### Step 3: Database Setup

Run migrations to create database tables:

```bash
# Generate migration files (if schema changed)
pnpm db:generate

# Run migrations
pnpm db:migrate

# Verify database connection
pnpm db:studio
# Opens Drizzle Studio at http://localhost:4983
```

**Database Schema Includes:**
- Users and authentication tables
- Chat history and messages
- Design tokens and templates
- Deployment tracking
- Error logging
- RLHF feedback collection

### Step 4: Test Locally

```bash
# Start development server
pnpm dev

# Open browser
open http://localhost:3000

# Test key features:
# 1. User registration/login
# 2. Chat creation
# 3. Component generation
# 4. Preview rendering
```

---

## Build Process

### Understanding the Build

The build process (`pnpm build`) performs:

1. **Database Migrations** - Runs `tsx lib/db/migrate`
2. **Next.js Build** - Compiles application with Turbopack
3. **Asset Optimization** - Minifies CSS, JS, and images
4. **Route Generation** - Creates static and dynamic routes

### Build Command

```bash
# Full production build
pnpm build

# Expected output:
# ⏳ Running migrations...
# ✅ Migrations completed in XXX ms
# Creating an optimized production build
# ✓ Compiled successfully
```

### Build Configuration

Key build settings in `next.config.ts`:

```typescript
const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    dangerouslyAllowSVG: true,
    contentDispositionType: 'attachment',
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
}
```

### Build Verification

Check build output:

```bash
ls -la .next/
# Should see:
# - static/
# - server/
# - cache/
# - BUILD_ID
```

---

## Deployment to Vercel

Vercel is the recommended platform for Next.js applications.

### Method 1: Vercel CLI (Recommended)

#### Install Vercel CLI

```bash
npm i -g vercel
```

#### Login to Vercel

```bash
vercel login
```

#### Deploy

```bash
# Preview deployment (staging)
vercel

# Production deployment
vercel --prod
```

### Method 2: GitHub Integration

#### Step 1: Push to GitHub

```bash
git add .
git commit -m "Prepare for deployment"
git push origin main
```

#### Step 2: Connect to Vercel

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click **"Add New Project"**
3. Import your GitHub repository
4. Configure project settings:
   - **Framework Preset:** Next.js
   - **Root Directory:** `./`
   - **Build Command:** `pnpm build`
   - **Output Directory:** `.next`
   - **Install Command:** `pnpm install`

#### Step 3: Configure Environment Variables

In Vercel project settings > Environment Variables, add all variables from `.env`:

**Critical Variables:**
- `POSTGRES_URL`
- `DATABASE_URL`
- `REDIS_URL`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `AUTH_SECRET`
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `NODE_ENV=production`
- `NEXT_PUBLIC_APP_URL`
- `DEPLOYMENT_ENCRYPTION_KEY`

**Environment Scopes:**
- Production: For main branch
- Preview: For pull requests
- Development: For local development

#### Step 4: Deploy

Click **"Deploy"** - Vercel will:
1. Clone repository
2. Install dependencies
3. Run database migrations
4. Build application
5. Deploy to edge network

### Vercel Project Settings

#### Domain Configuration

1. Go to **Settings > Domains**
2. Add your custom domain
3. Configure DNS:
   ```
   Type: CNAME
   Name: @ (or subdomain)
   Value: cname.vercel-dns.com
   ```

#### Build & Development Settings

```yaml
Build Command: pnpm build
Output Directory: .next
Install Command: pnpm install
Development Command: pnpm dev
Node.js Version: 18.x
```

#### Function Configuration

```yaml
Max Duration: 300s (for AI generation)
Memory: 1024 MB
Regions: Auto (or specify: iad1, sfo1, etc.)
```

---

## Alternative Platforms

### Netlify

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Login
netlify login

# Deploy
netlify deploy --prod
```

**netlify.toml:**
```toml
[build]
  command = "pnpm build"
  publish = ".next"

[build.environment]
  NODE_VERSION = "18"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

### Railway

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Initialize project
railway init

# Deploy
railway up
```

### Docker Deployment

**Dockerfile:**
```dockerfile
FROM node:18-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED 1

RUN npm install -g pnpm && pnpm build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

CMD ["node", "server.js"]
```

**Build and run:**
```bash
docker build -t ainative-studio .
docker run -p 3000:3000 --env-file .env ainative-studio
```

---

## Post-Deployment Verification

### Health Check Endpoints

Test these endpoints to verify deployment:

```bash
# 1. Application health
curl https://your-domain.com/

# 2. API health (if implemented)
curl https://your-domain.com/api/health

# 3. Authentication
curl -X POST https://your-domain.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"testpass"}'

# 4. Database connection (via any API endpoint)
# Should return proper response, not 500 error
```

### Manual Testing Checklist

- [ ] **Homepage loads correctly**
  - UI renders properly
  - No console errors
  - CSS styles applied

- [ ] **User Authentication**
  - [ ] Registration works
  - [ ] Login works
  - [ ] Session persists
  - [ ] Logout works

- [ ] **Chat Functionality**
  - [ ] Create new chat
  - [ ] Send messages
  - [ ] Receive AI responses
  - [ ] Real-time streaming works

- [ ] **Component Generation**
  - [ ] Template selection works
  - [ ] Custom prompts generate components
  - [ ] Preview renders correctly
  - [ ] Code is syntactically valid

- [ ] **Database Operations**
  - [ ] Chat history saves
  - [ ] User data persists
  - [ ] Design tokens store correctly

- [ ] **Rate Limiting**
  - [ ] Anonymous user limits enforced
  - [ ] Registered user limits work
  - [ ] Error messages are clear

- [ ] **Error Handling**
  - [ ] 404 pages work
  - [ ] 500 errors are logged
  - [ ] User-friendly error messages

### Performance Testing

```bash
# Load testing with autocannon
npm install -g autocannon

autocannon -c 10 -d 30 https://your-domain.com
# Tests 10 concurrent connections for 30 seconds

# Expected results:
# - Average latency: < 500ms
# - Requests/sec: > 100
# - Error rate: < 1%
```

### Security Verification

- [ ] **HTTPS enforced** (no HTTP access)
- [ ] **Headers configured**:
  ```bash
  curl -I https://your-domain.com
  # Should see:
  # - X-Frame-Options
  # - X-Content-Type-Options
  # - Strict-Transport-Security
  ```
- [ ] **Environment variables not exposed** (check Network tab)
- [ ] **API endpoints require authentication**
- [ ] **SQL injection protected** (Drizzle ORM)
- [ ] **XSS protected** (React escaping)

---

## Monitoring Setup

### Application Monitoring

#### Vercel Analytics (Built-in)

Enable in Vercel Dashboard:
1. Go to **Analytics** tab
2. Enable **Web Vitals**
3. Monitor:
   - Request count
   - Error rate
   - Response time
   - Geographic distribution

#### Custom Error Logging

Already implemented via `error_logs` table:

```typescript
// Automatic error logging
import { logError } from '@/lib/monitoring/error-logger'

try {
  // Your code
} catch (error) {
  await logError({
    level: 'error',
    message: error.message,
    context: { userId, chatId },
    stackTrace: error.stack,
  })
}
```

Query errors:

```sql
-- Recent errors
SELECT * FROM error_logs
ORDER BY timestamp DESC
LIMIT 100;

-- Errors by type
SELECT error_type, COUNT(*) as count
FROM error_logs
WHERE timestamp > NOW() - INTERVAL '24 hours'
GROUP BY error_type
ORDER BY count DESC;
```

#### Sentry Integration (Optional)

```bash
npm install @sentry/nextjs
```

**sentry.client.config.js:**
```javascript
import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.NODE_ENV,
})
```

### Database Monitoring

#### PostgreSQL Metrics

Monitor these queries:

```sql
-- Active connections
SELECT count(*) FROM pg_stat_activity;

-- Slow queries
SELECT query, mean_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;

-- Database size
SELECT pg_size_pretty(pg_database_size('your_db_name'));

-- Table sizes
SELECT schemaname, tablename,
       pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename))
FROM pg_tables
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

#### Redis Monitoring

```bash
# Connect to Redis
redis-cli -h your-redis-host -p 6379

# Monitor commands
MONITOR

# Check memory
INFO memory

# Key count
DBSIZE
```

### Performance Monitoring

#### Set Up Alerts

**Vercel Notifications:**
1. Go to **Settings > Notifications**
2. Enable alerts for:
   - Deployment failures
   - High error rates
   - Performance degradation

**Custom Alerts via Cron:**

Create `/app/api/cron/alerts/route.ts`:

```typescript
export async function GET() {
  // Check error rate
  const errorCount = await db
    .select()
    .from(error_logs)
    .where(gt(error_logs.timestamp, new Date(Date.now() - 3600000)))

  if (errorCount.length > 100) {
    // Send alert (email, Slack, PagerDuty)
    await sendAlert({
      type: 'high_error_rate',
      count: errorCount.length,
    })
  }

  return new Response('OK')
}
```

**Vercel Cron:**
```json
// vercel.json
{
  "crons": [{
    "path": "/api/cron/alerts",
    "schedule": "*/5 * * * *"
  }]
}
```

### Log Aggregation

Stream logs to monitoring service:

```bash
# Vercel CLI
vercel logs --follow

# Save to file
vercel logs > deployment-logs.txt
```

---

## Troubleshooting

### Common Issues and Solutions

#### 1. Build Failures

**Error:** `Migration failed`

```bash
# Solution: Check database connection
psql $POSTGRES_URL -c "SELECT 1"

# Verify migrations folder
ls -la lib/db/migrations/

# Run migrations manually
pnpm db:migrate
```

**Error:** `Module not found`

```bash
# Solution: Clear cache and reinstall
rm -rf node_modules .next
pnpm install
pnpm build
```

#### 2. Database Connection Issues

**Error:** `Connection timeout`

```bash
# Check database is accessible
pg_isready -h your-host -p 5432

# Test connection string
psql $POSTGRES_URL -c "\dt"

# Verify SSL mode (add to connection string)
POSTGRES_URL=postgresql://user:pass@host:5432/db?sslmode=require
```

**Error:** `Too many connections`

```typescript
// Solution: Configure connection pool
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  max: 20, // Maximum pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
})
```

#### 3. Redis Connection Issues

**Error:** `ECONNREFUSED`

```bash
# Verify Redis is running
redis-cli ping
# Should return: PONG

# Check Redis URL format
# Correct: redis://username:password@host:port
# Correct: rediss://username:password@host:port (SSL)
```

#### 4. API Rate Limiting

**Error:** `429 Too Many Requests`

```typescript
// Solution: Adjust rate limits
// In .env:
MAX_CHATS_PER_HOUR=100
MAX_ANONYMOUS_CHATS_PER_HOUR=10

// Or implement exponential backoff
async function retryWithBackoff(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn()
    } catch (error) {
      if (error.status === 429 && i < maxRetries - 1) {
        await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000))
        continue
      }
      throw error
    }
  }
}
```

#### 5. Anthropic API Errors

**Error:** `Invalid API key`

```bash
# Verify API key
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{...}'
```

**Error:** `Rate limit exceeded`

```typescript
// Implement queue system
import { Queue } from 'bull'

const aiQueue = new Queue('ai-generation', process.env.REDIS_URL)

aiQueue.process(async (job) => {
  return await generateComponent(job.data)
})

// Add to queue instead of direct call
await aiQueue.add({ prompt, userId })
```

#### 6. WebSocket Connection Failures

**Error:** `WebSocket connection failed`

```javascript
// Client-side debugging
const ws = new WebSocket('wss://your-domain.com/api/chat-ws')

ws.onerror = (error) => {
  console.error('WebSocket error:', error)
  // Fallback to HTTP polling
}

ws.onclose = (event) => {
  console.log('WebSocket closed:', event.code, event.reason)
  // Attempt reconnection
  setTimeout(() => connectWebSocket(), 5000)
}
```

#### 7. Memory Issues

**Error:** `JavaScript heap out of memory`

```bash
# Solution: Increase Node.js memory
NODE_OPTIONS="--max-old-space-size=4096" pnpm build

# Or in Vercel settings:
# Functions > Memory: 1024 MB or 3008 MB
```

#### 8. Slow Performance

**Investigation:**

```typescript
// Add performance monitoring
console.time('database-query')
const result = await db.select()...
console.timeEnd('database-query')

// Profile API endpoints
import { performance } from 'perf_hooks'

const start = performance.now()
// Your code
const end = performance.now()
console.log(`Execution time: ${end - start}ms`)
```

**Solutions:**
- Add database indexes
- Implement caching with Redis
- Use React.memo for heavy components
- Optimize images with next/image
- Enable Next.js production optimizations

---

## Rollback Procedures

### Vercel Rollback

#### Method 1: Vercel Dashboard

1. Go to **Deployments** tab
2. Find the last working deployment
3. Click **"⋯"** menu → **"Promote to Production"**
4. Confirm promotion

#### Method 2: Vercel CLI

```bash
# List recent deployments
vercel list

# Example output:
# Age  Deployment                    Status
# 2m   ainative-studio-abc123.vercel Ready
# 1h   ainative-studio-def456.vercel Ready

# Promote previous deployment
vercel promote ainative-studio-def456.vercel.app
```

#### Method 3: Git Revert

```bash
# Revert to previous commit
git log --oneline
# Find commit hash of working version

git revert HEAD --no-edit
git push origin main

# Vercel auto-deploys from main branch
```

### Database Rollback

#### Backup Before Deployment

```bash
# Automatic backup script
pg_dump $POSTGRES_URL > backup-$(date +%Y%m%d-%H%M%S).sql

# Verify backup
head -n 50 backup-*.sql
```

#### Restore from Backup

```bash
# Restore database
psql $POSTGRES_URL < backup-20260302-120000.sql

# Or restore specific tables
pg_restore -d $POSTGRES_URL -t users backup.sql
```

#### Migration Rollback

Drizzle ORM doesn't support automatic rollback. Manual process:

1. **Identify migration to rollback:**
   ```bash
   ls -la lib/db/migrations/
   # Note the migration file to undo
   ```

2. **Create reverse migration:**
   ```sql
   -- Example: If migration added a column
   -- Original: ALTER TABLE users ADD COLUMN new_field VARCHAR(255);
   -- Reverse:
   ALTER TABLE users DROP COLUMN new_field;
   ```

3. **Run reverse SQL:**
   ```bash
   psql $POSTGRES_URL -f reverse-migration.sql
   ```

### Code Rollback Checklist

- [ ] **Identify issue** - Error logs, user reports
- [ ] **Check deployment time** - Correlate with issue start
- [ ] **Review recent changes** - Git diff between deployments
- [ ] **Test rollback target** - Verify previous version works
- [ ] **Create database backup** - Before any changes
- [ ] **Execute rollback** - Via Vercel or Git revert
- [ ] **Verify rollback** - Run post-deployment tests
- [ ] **Monitor metrics** - Ensure issue resolved
- [ ] **Document incident** - For future reference
- [ ] **Plan fix** - Address root cause

### Emergency Rollback Script

Create `scripts/emergency-rollback.sh`:

```bash
#!/bin/bash
set -e

echo "EMERGENCY ROLLBACK INITIATED"
echo "=============================="

# Get current deployment
CURRENT=$(vercel list --limit 1 | grep Ready | awk '{print $2}')
echo "Current deployment: $CURRENT"

# Get previous deployment
PREVIOUS=$(vercel list --limit 2 | grep Ready | tail -n 1 | awk '{print $2}')
echo "Rolling back to: $PREVIOUS"

# Backup database
echo "Creating database backup..."
pg_dump $POSTGRES_URL > emergency-backup-$(date +%Y%m%d-%H%M%S).sql
echo "Backup created"

# Promote previous deployment
echo "Promoting previous deployment..."
vercel promote $PREVIOUS --yes

echo "Rollback complete"
echo "Please verify: https://your-domain.com"
```

Usage:
```bash
chmod +x scripts/emergency-rollback.sh
./scripts/emergency-rollback.sh
```

---

## Best Practices

### Pre-Deployment Checklist

- [ ] All tests passing (`pnpm test`)
- [ ] Build succeeds locally (`pnpm build`)
- [ ] Environment variables documented
- [ ] Database backup created
- [ ] Migration tested on staging
- [ ] Performance benchmarks meet targets
- [ ] Security scan completed
- [ ] Changelog updated
- [ ] Monitoring configured
- [ ] Rollback plan prepared

### Deployment Strategy

**Recommended: Staged Rollout**

1. **Staging Deployment**
   - Deploy to preview environment
   - Run full test suite
   - Manual QA testing

2. **Canary Release** (10% traffic)
   - Deploy to subset of users
   - Monitor error rates
   - Check performance metrics

3. **Full Production** (100% traffic)
   - Promote to all users
   - Continue monitoring
   - Be ready to rollback

### Monitoring After Deployment

**First 30 minutes:**
- Watch error logs actively
- Monitor response times
- Check database connections
- Verify API endpoints

**First 24 hours:**
- Review error rates hourly
- Check resource utilization
- Monitor user feedback
- Analyze performance metrics

**First Week:**
- Daily metric reviews
- User feedback analysis
- Performance optimization
- Bug fix deployment if needed

---

## Additional Resources

### Documentation Links

- [Next.js Deployment](https://nextjs.org/docs/deployment)
- [Vercel Documentation](https://vercel.com/docs)
- [Drizzle ORM Migrations](https://orm.drizzle.team/docs/migrations)
- [Anthropic API Reference](https://docs.anthropic.com/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)

### Support Channels

- **GitHub Issues:** [Project Issues](https://github.com/YOUR_ORG/builder-ainative-studio/issues)
- **Team Documentation:** `/docs` directory
- **Emergency Contact:** [Your team contact info]

### Deployment Automation

Consider implementing:
- GitHub Actions for CI/CD
- Automated testing on PR
- Automatic preview deployments
- Scheduled database backups
- Performance monitoring alerts

---

## Conclusion

This deployment guide provides a comprehensive approach to deploying AINative Component Builder. Follow each section carefully, test thoroughly, and maintain good monitoring practices.

For questions or issues not covered here, refer to the project's GitHub issues or contact the development team.

**Happy Deploying!**
