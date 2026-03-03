# Production Deployment Configuration - Issue #13

## Summary

This PR implements comprehensive production deployment configuration for builder.ainative.studio (GitHub Issue #13).

## Files Created

### 1. `/vercel.json` - Vercel deployment configuration
- Security headers (CSP, XSS, Frame, Referrer policies)
- Cache control for API routes
- Health check rewrites (/healthz → /api/health)
- Production environment settings
- Region configuration (iad1)

### 2. `/lib/monitoring.ts` - Comprehensive monitoring service
- Token usage tracking per generation
- Generation time metrics (avg, min, max, percentiles)
- Error metrics collection from database
- System health checks (database, Redis)
- Performance timers and logging
- Singleton monitoring service instance

### 3. `/app/api/health/route.ts` - Health check endpoint
- Database connectivity check with response time
- Redis connectivity check (when configured)
- Error rate monitoring (5min, 1hour, 24hour windows)
- System uptime tracking
- Returns 200 (healthy) or 503 (degraded/unhealthy)

### 4. `/scripts/validate-env.ts` - Environment validation
- Validates all required environment variables
- Checks variable formats (URLs, API keys, etc.)
- Provides helpful error messages
- Exit code 0 (success) or 1 (failure)

###  5. `/scripts/deploy-production.sh` - Automated deployment
- Environment variable validation
- Test execution
- Git status verification
- Application build
- Preview deployment with testing
- Production deployment confirmation
- Post-deployment verification

### 6. `package.json` - Added deployment scripts
```json
"validate:env": "npx tsx scripts/validate-env.ts"
"deploy:preview": "vercel",
"deploy:production": "./scripts/deploy-production.sh"
```

## Features Implemented

- ✅ Production environment variables configuration
- ✅ Vercel deployment with security headers
- ✅ Custom domain setup (builder.ainative.studio)
- ✅ Comprehensive monitoring and metrics tracking
- ✅ Health check endpoints (/api/health, /healthz)
- ✅ Error logging to database
- ✅ Token usage tracking
- ✅ Generation time metrics
- ✅ Automated deployment scripts
- ✅ Environment validation
- ✅ Database and Redis monitoring

## Required Environment Variables

See `.env.example` for full list. Critical variables:
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `USE_SUBAGENTS`
- `POSTGRES_URL`, `DATABASE_URL`
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- `AUTH_SECRET`, `DEPLOYMENT_ENCRYPTION_KEY`
- `MAX_CHATS_PER_HOUR`, `MAX_ANONYMOUS_CHATS_PER_HOUR`

## Deployment Process

1. Validate environment: `pnpm run validate:env`
2. Deploy to preview: `pnpm run deploy:preview`
3. Deploy to production: `pnpm run deploy:production`

## Monitoring

- Health check: `https://builder.ainative.studio/api/health`
- Vercel Dashboard: Real-time logs and analytics
- Database queries: Error logs, generation metrics, usage stats

## Testing

All configuration tested and verified:
- Environment validation script
- Health check endpoint
- Monitoring service
- Deployment scripts

Resolves #13
