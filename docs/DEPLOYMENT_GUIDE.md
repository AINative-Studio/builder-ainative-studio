# Production Deployment Guide

Complete guide for deploying builder.ainative.studio to production on Vercel.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Initial Setup](#initial-setup)
- [Environment Configuration](#environment-configuration)
- [Domain Setup](#domain-setup)
- [Database Setup](#database-setup)
- [Redis Setup](#redis-setup)
- [Deployment Process](#deployment-process)
- [Post-Deployment Verification](#post-deployment-verification)
- [Monitoring Setup](#monitoring-setup)
- [Rollback Procedures](#rollback-procedures)
- [Troubleshooting](#troubleshooting)

## Prerequisites

- [x] Vercel account with team access
- [x] Domain: builder.ainative.studio configured in DNS
- [x] Vercel Postgres database provisioned
- [x] Upstash Redis instance configured
- [x] Anthropic API key with sufficient quota
- [x] Meta API key for LLAMA
- [x] OpenAI API key for embeddings
- [x] ZeroDB project and API key
- [x] All team members have reviewed changes

## Initial Setup

### 1. Install Vercel CLI

```bash
npm i -g vercel
vercel login
```

### 2. Link Project to Vercel

```bash
cd builder-ainative-studio
vercel link
```

Select your team and project when prompted.

### 3. Pull Current Environment Variables (Optional)

```bash
# Download existing environment variables
vercel env pull .env.production.local
```

## Environment Configuration

### Step 1: Generate Required Secrets

```bash
# Generate AUTH_SECRET
openssl rand -base64 32

# Generate DEPLOYMENT_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Step 2: Set Environment Variables in Vercel

You can set environment variables via:

#### Option A: Vercel Dashboard

1. Go to https://vercel.com/your-team/builder-ainative-studio/settings/environment-variables
2. Add each variable from the [Environment Variables Setup Guide](./PRODUCTION_ENV_SETUP.md)
3. Set scope to **Production** only

#### Option B: Vercel CLI

```bash
# Core configuration
vercel env add NODE_ENV production
# Enter: production

vercel env add NEXT_PUBLIC_APP_URL production
# Enter: https://builder.ainative.studio

vercel env add AUTH_SECRET production
# Enter: <your-generated-secret>

# Database
vercel env add POSTGRES_URL production
# Enter: <postgres-url-from-vercel-postgres>

vercel env add DATABASE_URL production
# Enter: <postgres-url-from-vercel-postgres>

# Redis
vercel env add UPSTASH_REDIS_REST_URL production
# Enter: <upstash-redis-rest-url>

vercel env add UPSTASH_REDIS_REST_TOKEN production
# Enter: <upstash-redis-rest-token>

vercel env add REDIS_URL production
# Enter: <redis-url>

# AI Services
vercel env add ANTHROPIC_API_KEY production
# Enter: <anthropic-api-key>

vercel env add ANTHROPIC_MODEL production
# Enter: claude-sonnet-4-5-20250929

vercel env add USE_SUBAGENTS production
# Enter: true

vercel env add META_API_KEY production
# Enter: <meta-api-key>

vercel env add OPENAI_API_KEY production
# Enter: <openai-api-key>

# ZeroDB
vercel env add ZERODB_MCP_API_KEY production
# Enter: <zerodb-api-key>

vercel env add ZERODB_PROJECT_ID production
# Enter: <zerodb-project-id>

# Encryption
vercel env add DEPLOYMENT_ENCRYPTION_KEY production
# Enter: <your-generated-encryption-key>

# Rate Limiting
vercel env add MAX_CHATS_PER_HOUR production
# Enter: 50

vercel env add MAX_ANONYMOUS_CHATS_PER_HOUR production
# Enter: 10

# Monitoring
vercel env add LOG_LEVEL production
# Enter: info
```

### Step 3: Validate Configuration

```bash
# Pull environment variables locally
vercel env pull .env.production.local

# Validate all required variables are set
NODE_ENV=production npx tsx scripts/validate-env.ts
```

## Domain Setup

### 1. Configure Custom Domain in Vercel

```bash
# Add domain via CLI
vercel domains add builder.ainative.studio

# Or via dashboard:
# Settings > Domains > Add Domain
```

### 2. Update DNS Records

Add the following DNS records in your domain registrar:

```
Type: CNAME
Name: builder
Value: cname.vercel-dns.com
```

### 3. Enable SSL

Vercel automatically provisions SSL certificates via Let's Encrypt. Wait for the certificate to be issued (usually 1-2 minutes).

### 4. Force HTTPS

In Vercel project settings:
- Settings > Domains > builder.ainative.studio
- Enable "Always use HTTPS"

## Database Setup

### 1. Create Vercel Postgres Database

```bash
# Via Vercel Dashboard:
# Storage > Create Database > Postgres
# Or link existing database
```

### 2. Run Database Migrations

Migrations run automatically during build via the `build` script in `package.json`:

```json
"build": "tsx lib/db/migrate && next build --turbopack"
```

To manually run migrations:

```bash
# Set POSTGRES_URL environment variable
export POSTGRES_URL="<your-production-database-url>"

# Run migrations
pnpm run db:migrate
```

### 3. Verify Database Schema

```bash
# Connect to production database
psql $POSTGRES_URL

# List tables
\dt

# Verify key tables exist:
# - users
# - chats
# - messages
# - generations
# - error_logs
# - deployments
# etc.
```

## Redis Setup

### 1. Create Upstash Redis Instance

1. Go to https://console.upstash.com/redis
2. Create new database
3. Select region closest to your Vercel deployment (us-east-1 recommended)
4. Copy REST URL and token
5. Add to Vercel environment variables

### 2. Configure Redis for Standard Connections

For full Redis compatibility (if needed):
- Use Upstash Redis with standard connection mode
- Or provision separate Redis instance (Railway, Render, etc.)

## Deployment Process

### Automated Deployment (Recommended)

Use the provided deployment script:

```bash
./scripts/deploy-production.sh
```

This script will:
1. Validate environment variables
2. Run tests
3. Check git status
4. Build the application
5. Deploy to preview
6. Test preview deployment
7. Prompt for production confirmation
8. Deploy to production
9. Verify production deployment

### Manual Deployment

```bash
# Step 1: Validate environment
npx tsx scripts/validate-env.ts

# Step 2: Run tests
pnpm run test

# Step 3: Build locally
pnpm run build

# Step 4: Deploy to preview
vercel

# Step 5: Test preview deployment
curl https://your-preview-url.vercel.app/api/health

# Step 6: Deploy to production
vercel --prod
```

## Post-Deployment Verification

### 1. Health Check

```bash
# Check system health
curl https://builder.ainative.studio/api/health

# Expected response:
{
  "status": "healthy",
  "timestamp": "2026-03-02T...",
  "uptime": 123,
  "checks": {
    "database": {
      "status": "connected",
      "responseTime": 45
    },
    "redis": {
      "status": "connected",
      "responseTime": 12
    }
  },
  "errors": {
    "last5Minutes": 0,
    "last1Hour": 0,
    "last24Hours": 0
  }
}
```

### 2. Test Key User Flows

- [ ] Homepage loads successfully
- [ ] User can register/login
- [ ] Chat creation works
- [ ] AI generation works
- [ ] Code preview works
- [ ] Export functionality works
- [ ] Deployment to platforms works

### 3. Verify Database Connectivity

```bash
# Check database connection from application
curl https://builder.ainative.studio/api/chats

# Should return user's chats or authentication error
```

### 4. Check Error Logs

```bash
# Monitor Vercel logs
vercel logs --follow

# Check error logs in database
psql $POSTGRES_URL -c "SELECT * FROM error_logs ORDER BY timestamp DESC LIMIT 10;"
```

## Monitoring Setup

### 1. Built-in Monitoring

The application includes comprehensive monitoring:

- **Health Check**: `GET /api/health`
- **Error Logs**: Stored in `error_logs` table
- **Generation Metrics**: Stored in `generations` table
- **Token Usage**: Tracked per generation

### 2. Vercel Analytics

Enable in Vercel Dashboard:
- Analytics > Enable Analytics
- Monitor page views, performance, Web Vitals

### 3. External Monitoring (Optional)

Set up external monitoring with:

#### UptimeRobot / Pingdom

```
URL to monitor: https://builder.ainative.studio/api/health
Interval: 5 minutes
Alert on: Status code != 200
```

#### Sentry (Error Tracking)

1. Create Sentry project
2. Add `SENTRY_DSN` environment variable
3. Errors will automatically be sent to Sentry

### 4. Monitoring Dashboards

Access monitoring data:

- **Vercel Dashboard**: Real-time logs and analytics
- **Error Logs**: Query `error_logs` table
- **Usage Metrics**: Query `generations` table
- **Custom Dashboard**: Build using database queries

Example queries:

```sql
-- Error rate by endpoint (last 24 hours)
SELECT
  endpoint,
  COUNT(*) as error_count,
  error_type
FROM error_logs
WHERE timestamp > NOW() - INTERVAL '24 hours'
GROUP BY endpoint, error_type
ORDER BY error_count DESC;

-- Average generation time by model
SELECT
  model,
  COUNT(*) as generation_count,
  AVG(generation_time_ms) as avg_time_ms,
  MAX(generation_time_ms) as max_time_ms
FROM generations
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY model;

-- Token usage by user (if token fields are added)
SELECT
  user_id,
  COUNT(*) as generations,
  SUM(generation_time_ms) as total_generation_time_ms
FROM generations
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY user_id
ORDER BY generations DESC
LIMIT 10;
```

## Rollback Procedures

### Instant Rollback

Vercel supports instant rollback to previous deployments:

```bash
# List recent deployments
vercel ls

# Rollback to specific deployment
vercel rollback <deployment-url>

# Or via dashboard:
# Deployments > Click on previous deployment > Promote to Production
```

### Database Rollback

If database migrations cause issues:

```bash
# Connect to database
psql $POSTGRES_URL

# Rollback last migration (if using versioned migrations)
# Check lib/db/migrations/ for migration files
# Manually rollback changes or restore from backup
```

### Emergency Procedures

If production is completely broken:

1. **Immediate**: Rollback to last known good deployment
2. **Investigate**: Check error logs and Vercel function logs
3. **Fix**: Create hotfix on main branch or revert commit
4. **Deploy**: Push fix and deploy immediately
5. **Monitor**: Watch health check and error rates

## Troubleshooting

### Deployment Fails

**Build Errors:**
```bash
# Check build logs in Vercel dashboard
# Common issues:
# - Missing environment variables
# - Database migration failures
# - TypeScript errors
# - Dependency issues
```

**Solutions:**
- Verify all environment variables are set
- Check build logs for specific error messages
- Test build locally: `pnpm run build`
- Check database connection during build

### Health Check Fails

**Database Connection Issues:**
```bash
# Verify POSTGRES_URL is set correctly
vercel env ls

# Test database connection
psql $POSTGRES_URL -c "SELECT 1;"

# Check database logs in Vercel Storage
```

**Redis Connection Issues:**
```bash
# Verify Redis environment variables
vercel env ls | grep REDIS

# Test Redis connection
redis-cli -u $REDIS_URL ping
```

### High Error Rates

**Check Error Logs:**
```bash
# Stream Vercel logs
vercel logs --follow

# Query error_logs table
psql $POSTGRES_URL -c "SELECT * FROM error_logs ORDER BY timestamp DESC LIMIT 50;"
```

**Common Issues:**
- API rate limits exceeded
- Database connection pool exhausted
- Redis connection issues
- Invalid environment configuration

### Slow Performance

**Check Metrics:**
```bash
# Query generation times
psql $POSTGRES_URL -c "
  SELECT
    AVG(generation_time_ms) as avg_ms,
    MAX(generation_time_ms) as max_ms,
    COUNT(*) as count
  FROM generations
  WHERE created_at > NOW() - INTERVAL '1 hour';
"

# Check Vercel function logs for slow requests
vercel logs --since 1h
```

**Optimization Steps:**
- Check database query performance
- Verify Redis caching is working
- Monitor API response times
- Check for database connection pool issues

## Best Practices

1. **Always deploy to preview first** - Test thoroughly before production
2. **Monitor immediately after deployment** - Watch for errors in first 15 minutes
3. **Keep rollback plan ready** - Know how to rollback quickly
4. **Communicate deployments** - Notify team before major deployments
5. **Deploy during low-traffic periods** - Minimize impact of issues
6. **Have database backups** - Automated backups via Vercel Postgres
7. **Test locally first** - Verify changes work in local environment
8. **Use feature flags** - Gradually roll out new features
9. **Monitor metrics** - Track error rates, performance, usage
10. **Document issues** - Record and learn from deployment problems

## Support and Escalation

For deployment issues:

1. Check this guide's troubleshooting section
2. Review Vercel deployment logs
3. Check database and Redis logs
4. Query error_logs table for application errors
5. Contact team lead if issues persist
6. Rollback if issue is critical

## Maintenance Windows

Schedule maintenance for:
- Major database schema changes
- Infrastructure upgrades
- Breaking API changes
- Large-scale data migrations

Recommended process:
1. Announce maintenance window 24-48 hours in advance
2. Deploy during low-traffic period (2-4 AM EST)
3. Have rollback plan ready
4. Monitor closely during and after maintenance
5. Communicate completion and any issues

## Additional Resources

- [Vercel Documentation](https://vercel.com/docs)
- [Next.js Deployment](https://nextjs.org/docs/deployment)
- [Environment Variables Setup](./PRODUCTION_ENV_SETUP.md)
- [Monitoring Dashboard Queries](./MONITORING_QUERIES.md)
