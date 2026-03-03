# Production Deployment Configuration - Issue #13

This directory contains all production deployment configuration and documentation for builder.ainative.studio.

## Overview

This configuration implements a complete production deployment setup for the AINative Builder application with:

- ✅ Production environment variables management
- ✅ Vercel deployment configuration with security headers
- ✅ Comprehensive monitoring and metrics tracking
- ✅ Health check endpoints
- ✅ Automated deployment scripts
- ✅ Database migration handling
- ✅ Error logging and alerting

## Files Created

### Configuration Files

1. **`/vercel.json`** - Vercel deployment configuration
   - Security headers (CSP, XSS, Frame options)
   - Cache control for API routes
   - Health check rewrites
   - Production environment settings

### Documentation

2. **`/docs/PRODUCTION_ENV_SETUP.md`** - Environment variables setup guide
   - Complete list of required environment variables
   - Setup instructions for Vercel Dashboard and CLI
   - Validation checklist
   - Security best practices

3. **`/docs/DEPLOYMENT_GUIDE.md`** - Complete deployment guide
   - Prerequisites and initial setup
   - Domain configuration
   - Database and Redis setup
   - Deployment process
   - Post-deployment verification
   - Monitoring setup
   - Rollback procedures
   - Troubleshooting

4. **`/docs/MONITORING_QUERIES.md`** - Production monitoring SQL queries
   - Health and status queries
   - Error monitoring
   - Performance metrics
   - User analytics
   - Rate limiting monitoring
   - Deployment tracking
   - Database maintenance

5. **`/docs/PRODUCTION_DEPLOYMENT_README.md`** - This file

### Application Code

6. **`/lib/monitoring.ts`** - Comprehensive monitoring service
   - Token usage tracking
   - Generation time metrics
   - Error metrics collection
   - System health checks
   - Performance timers

7. **`/app/api/health/route.ts`** - Health check endpoint
   - Database connectivity check
   - Redis connectivity check
   - Error rate monitoring
   - System uptime tracking
   - Returns 200 (healthy) or 503 (degraded/unhealthy)

### Scripts

8. **`/scripts/validate-env.ts`** - Environment validation script
   - Validates all required environment variables
   - Checks variable formats and values
   - Provides helpful error messages
   - Run before deployment

9. **`/scripts/deploy-production.sh`** - Automated deployment script
   - Environment validation
   - Test execution
   - Git status check
   - Build verification
   - Preview deployment
   - Production deployment with confirmation
   - Post-deployment verification

## Quick Start

### 1. Set Up Environment Variables

Follow the [Environment Setup Guide](./PRODUCTION_ENV_SETUP.md):

```bash
# Validate environment configuration
npx tsx scripts/validate-env.ts
```

### 2. Deploy to Production

```bash
# Option A: Automated deployment (recommended)
./scripts/deploy-production.sh

# Option B: Manual deployment
vercel --prod
```

### 3. Verify Deployment

```bash
# Check health endpoint
curl https://builder.ainative.studio/api/health

# Expected response:
{
  "status": "healthy",
  "timestamp": "2026-03-02T...",
  "uptime": 123,
  "checks": {
    "database": { "status": "connected", "responseTime": 45 },
    "redis": { "status": "connected", "responseTime": 12 }
  },
  "errors": {
    "last5Minutes": 0,
    "last1Hour": 0,
    "last24Hours": 0
  }
}
```

## Required Environment Variables

### Critical Variables (Must be set before deployment)

```bash
# Core
NODE_ENV=production
NEXT_PUBLIC_APP_URL=https://builder.ainative.studio
AUTH_SECRET=<generated-secret>

# Database
POSTGRES_URL=<vercel-postgres-url>
DATABASE_URL=<vercel-postgres-url>

# Redis
UPSTASH_REDIS_REST_URL=<upstash-url>
UPSTASH_REDIS_REST_TOKEN=<upstash-token>
REDIS_URL=<redis-url>

# AI Services
ANTHROPIC_API_KEY=<anthropic-key>
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
USE_SUBAGENTS=true
META_API_KEY=<meta-key>
OPENAI_API_KEY=<openai-key>

# ZeroDB
ZERODB_MCP_API_KEY=<zerodb-key>
ZERODB_PROJECT_ID=<zerodb-project-id>

# Security
DEPLOYMENT_ENCRYPTION_KEY=<64-char-hex-key>

# Rate Limiting
MAX_CHATS_PER_HOUR=50
MAX_ANONYMOUS_CHATS_PER_HOUR=10

# Monitoring
LOG_LEVEL=info
```

See [PRODUCTION_ENV_SETUP.md](./PRODUCTION_ENV_SETUP.md) for complete details.

## Monitoring

### Built-in Monitoring Features

1. **Health Check Endpoint**: `/api/health` or `/healthz`
   - Database connectivity
   - Redis connectivity
   - Error rates
   - System uptime

2. **Error Logging**: Automatic error tracking
   - All errors logged to `error_logs` table
   - Includes stack traces, context, and user info
   - Queryable via SQL (see MONITORING_QUERIES.md)

3. **Generation Metrics**: Performance tracking
   - Token usage per generation
   - Generation time metrics
   - Model performance comparison
   - Template usage statistics

4. **Performance Timers**: Operation timing
   - Automatic performance logging
   - Slow operation warnings
   - Request/response tracking

### Monitoring Queries

Access production metrics using SQL queries from [MONITORING_QUERIES.md](./MONITORING_QUERIES.md):

```sql
-- Error rate (last hour)
SELECT COUNT(*) as error_count
FROM error_logs
WHERE timestamp > NOW() - INTERVAL '1 hour';

-- Average generation time
SELECT AVG(generation_time_ms) as avg_ms
FROM generations
WHERE created_at > NOW() - INTERVAL '24 hours';

-- Active users (last 24 hours)
SELECT COUNT(DISTINCT user_id) as active_users
FROM generations
WHERE created_at > NOW() - INTERVAL '24 hours';
```

### External Monitoring Setup

Recommended external monitoring:

1. **Uptime Monitoring** (UptimeRobot, Pingdom)
   - Monitor: `https://builder.ainative.studio/api/health`
   - Interval: 5 minutes
   - Alert on: Status != 200

2. **Error Tracking** (Sentry)
   - Set `SENTRY_DSN` environment variable
   - Automatic error reporting
   - Stack traces and context

3. **Analytics** (Vercel Analytics)
   - Enable in Vercel Dashboard
   - Page views, performance, Web Vitals

## Security Features

### Headers

- **X-Content-Type-Options**: nosniff
- **X-Frame-Options**: DENY
- **X-XSS-Protection**: 1; mode=block
- **Referrer-Policy**: strict-origin-when-cross-origin
- **Permissions-Policy**: Restricted camera, microphone, geolocation

### API Security

- Rate limiting via Upstash Redis
- API route caching disabled
- Encrypted deployment credentials (AES-256-GCM)
- Secure session management

### Database Security

- SSL-enabled PostgreSQL connections
- Connection pooling
- Prepared statements (SQL injection protection)
- User authentication required for all data access

## Deployment Checklist

Before deploying to production:

- [ ] All environment variables set in Vercel
- [ ] Environment validation passed (`npx tsx scripts/validate-env.ts`)
- [ ] Tests passing (`pnpm run test`)
- [ ] Build successful (`pnpm run build`)
- [ ] Database migrations tested
- [ ] Domain configured (builder.ainative.studio)
- [ ] SSL certificate active
- [ ] Health check endpoint tested
- [ ] Monitoring configured
- [ ] Team notified of deployment

## Deployment Process

### Automated Deployment

```bash
# Run the deployment script
./scripts/deploy-production.sh
```

The script will:
1. Validate environment variables
2. Run tests
3. Check git status
4. Build application
5. Deploy to preview
6. Test preview deployment
7. Prompt for production confirmation
8. Deploy to production
9. Verify production deployment

### Manual Deployment

```bash
# 1. Validate environment
npx tsx scripts/validate-env.ts

# 2. Run tests
pnpm run test

# 3. Deploy to preview
vercel

# 4. Deploy to production
vercel --prod
```

## Rollback Procedure

If issues occur after deployment:

```bash
# Option A: Via CLI
vercel ls  # List deployments
vercel rollback <deployment-url>

# Option B: Via Dashboard
# Deployments > Previous deployment > Promote to Production
```

Database rollback (if needed):
1. Connect to database: `psql $POSTGRES_URL`
2. Manually revert changes or restore from backup

## Troubleshooting

### Build Failures

Check Vercel build logs for:
- Missing environment variables
- Database migration failures
- TypeScript errors
- Dependency issues

### Health Check Failures

```bash
# Check database connection
psql $POSTGRES_URL -c "SELECT 1;"

# Check Redis connection
redis-cli -u $REDIS_URL ping

# View application logs
vercel logs --follow
```

### High Error Rates

```sql
-- Query recent errors
SELECT * FROM error_logs
ORDER BY timestamp DESC
LIMIT 50;
```

See [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) for complete troubleshooting guide.

## Monitoring Dashboards

### Vercel Dashboard

- Real-time logs
- Deployment history
- Analytics and Web Vitals
- Environment variables
- Domain configuration

### Custom SQL Dashboards

Use queries from [MONITORING_QUERIES.md](./MONITORING_QUERIES.md) to create custom dashboards:

- Error rates and trends
- Performance metrics
- User engagement
- Deployment success rates
- Rate limiting statistics

## Support

For deployment issues:

1. Check [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) troubleshooting section
2. Review Vercel deployment logs
3. Query `error_logs` table for application errors
4. Check health endpoint: `/api/health`
5. Contact team lead if issues persist

## Additional Resources

- [Production Environment Setup](./PRODUCTION_ENV_SETUP.md) - Complete environment variable guide
- [Deployment Guide](./DEPLOYMENT_GUIDE.md) - Comprehensive deployment documentation
- [Monitoring Queries](./MONITORING_QUERIES.md) - SQL queries for monitoring
- [Vercel Documentation](https://vercel.com/docs)
- [Next.js Deployment](https://nextjs.org/docs/deployment)

## Related Issue

This configuration resolves GitHub Issue #13: Production Deployment Configuration

Features implemented:
- ✅ Production environment variables setup
- ✅ Vercel deployment configuration
- ✅ Custom domain setup (builder.ainative.studio)
- ✅ Monitoring and metrics tracking
- ✅ Deployment scripts and automation
- ✅ Health check endpoints
- ✅ Error logging and alerting
- ✅ Performance monitoring
- ✅ Complete documentation

## Maintenance

### Regular Tasks

- **Daily**: Monitor health endpoint and error rates
- **Weekly**: Review performance metrics and slow queries
- **Monthly**: Clean up old error logs (>30 days)
- **Quarterly**: Review and update environment variables
- **As needed**: Update documentation with new learnings

### Database Maintenance

```sql
-- Clean old error logs (>30 days)
DELETE FROM error_logs
WHERE timestamp < NOW() - INTERVAL '30 days';

-- Clean old anonymous chat logs (>7 days)
DELETE FROM anonymous_chat_logs
WHERE created_at < NOW() - INTERVAL '7 days';

-- Vacuum and analyze
VACUUM ANALYZE error_logs;
VACUUM ANALYZE generations;
```

## Version History

- **v1.0.0** (2026-03-02): Initial production deployment configuration
  - Vercel configuration
  - Environment setup
  - Monitoring implementation
  - Health check endpoint
  - Deployment scripts
  - Complete documentation
