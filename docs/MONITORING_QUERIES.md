# Production Monitoring Queries

SQL queries and monitoring commands for builder.ainative.studio production environment.

## Database Connection

```bash
# Connect to production database
psql $POSTGRES_URL
```

## Health & Status Queries

### System Health Check

```sql
-- Check if all critical tables exist
SELECT
  schemaname,
  tablename
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- Check database size
SELECT
  pg_size_pretty(pg_database_size(current_database())) as database_size;

-- Check active connections
SELECT
  count(*) as active_connections,
  max_conn
FROM pg_stat_activity
CROSS JOIN (SELECT setting::int as max_conn FROM pg_settings WHERE name = 'max_connections') s
WHERE state = 'active';
```

## Error Monitoring

### Recent Errors

```sql
-- Last 50 errors
SELECT
  id,
  timestamp,
  level,
  error_type,
  endpoint,
  message,
  user_id
FROM error_logs
ORDER BY timestamp DESC
LIMIT 50;

-- Errors in last hour
SELECT
  COUNT(*) as error_count,
  level,
  error_type
FROM error_logs
WHERE timestamp > NOW() - INTERVAL '1 hour'
GROUP BY level, error_type
ORDER BY error_count DESC;

-- Errors by endpoint (last 24 hours)
SELECT
  endpoint,
  COUNT(*) as error_count,
  error_type,
  level
FROM error_logs
WHERE timestamp > NOW() - INTERVAL '24 hours'
  AND endpoint IS NOT NULL
GROUP BY endpoint, error_type, level
ORDER BY error_count DESC
LIMIT 20;

-- Error rate trend (hourly for last 24 hours)
SELECT
  DATE_TRUNC('hour', timestamp) as hour,
  COUNT(*) as error_count,
  level
FROM error_logs
WHERE timestamp > NOW() - INTERVAL '24 hours'
GROUP BY hour, level
ORDER BY hour DESC;
```

### Critical Errors

```sql
-- Fatal errors in last 24 hours
SELECT
  timestamp,
  error_type,
  message,
  endpoint,
  stack_trace
FROM error_logs
WHERE level = 'fatal'
  AND timestamp > NOW() - INTERVAL '24 hours'
ORDER BY timestamp DESC;

-- Errors affecting multiple users
SELECT
  error_type,
  COUNT(DISTINCT user_id) as affected_users,
  COUNT(*) as total_errors,
  MAX(timestamp) as last_occurrence
FROM error_logs
WHERE timestamp > NOW() - INTERVAL '24 hours'
  AND user_id IS NOT NULL
GROUP BY error_type
HAVING COUNT(DISTINCT user_id) > 5
ORDER BY affected_users DESC;
```

## Performance Monitoring

### Generation Metrics

```sql
-- Generation performance (last 24 hours)
SELECT
  model,
  COUNT(*) as generation_count,
  AVG(generation_time_ms) as avg_time_ms,
  MIN(generation_time_ms) as min_time_ms,
  MAX(generation_time_ms) as max_time_ms,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY generation_time_ms) as p50_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY generation_time_ms) as p95_ms,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY generation_time_ms) as p99_ms
FROM generations
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY model;

-- Slow generations (>10 seconds)
SELECT
  id,
  chat_id,
  user_id,
  model,
  generation_time_ms,
  template_used,
  created_at
FROM generations
WHERE generation_time_ms > 10000
  AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY generation_time_ms DESC
LIMIT 20;

-- Generation rate over time (hourly)
SELECT
  DATE_TRUNC('hour', created_at) as hour,
  COUNT(*) as generation_count,
  AVG(generation_time_ms) as avg_time_ms
FROM generations
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY hour
ORDER BY hour DESC;
```

### Template Usage

```sql
-- Most used templates (last 7 days)
SELECT
  template_used,
  COUNT(*) as usage_count,
  AVG(generation_time_ms) as avg_generation_time
FROM generations
WHERE created_at > NOW() - INTERVAL '7 days'
  AND template_used IS NOT NULL
GROUP BY template_used
ORDER BY usage_count DESC
LIMIT 20;

-- Template performance comparison
SELECT
  template_used,
  COUNT(*) as count,
  AVG(generation_time_ms) as avg_time,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY generation_time_ms) as p95_time
FROM generations
WHERE created_at > NOW() - INTERVAL '24 hours'
  AND template_used IS NOT NULL
GROUP BY template_used
ORDER BY count DESC;
```

## User Analytics

### Active Users

```sql
-- Daily active users (last 7 days)
SELECT
  DATE(created_at) as date,
  COUNT(DISTINCT user_id) as active_users,
  COUNT(*) as total_generations
FROM generations
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY date
ORDER BY date DESC;

-- Most active users (last 30 days)
SELECT
  u.id,
  u.email,
  COUNT(g.id) as generation_count,
  AVG(g.generation_time_ms) as avg_generation_time,
  MAX(g.created_at) as last_activity
FROM users u
LEFT JOIN generations g ON g.user_id = u.id
WHERE g.created_at > NOW() - INTERVAL '30 days'
GROUP BY u.id, u.email
ORDER BY generation_count DESC
LIMIT 20;

-- New user registrations (last 30 days)
SELECT
  DATE(created_at) as date,
  COUNT(*) as new_users
FROM users
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY date
ORDER BY date DESC;
```

### User Engagement

```sql
-- Chats per user (last 7 days)
SELECT
  COUNT(DISTINCT chat_id) as total_chats,
  COUNT(DISTINCT user_id) as unique_users,
  ROUND(COUNT(DISTINCT chat_id)::numeric / NULLIF(COUNT(DISTINCT user_id), 0), 2) as chats_per_user
FROM generations
WHERE created_at > NOW() - INTERVAL '7 days';

-- User retention (users active in multiple weeks)
SELECT
  user_id,
  COUNT(DISTINCT DATE_TRUNC('week', created_at)) as active_weeks
FROM generations
WHERE created_at > NOW() - INTERVAL '8 weeks'
GROUP BY user_id
HAVING COUNT(DISTINCT DATE_TRUNC('week', created_at)) > 1
ORDER BY active_weeks DESC;
```

## Rate Limiting

### Anonymous Chat Tracking

```sql
-- Anonymous chats by IP (last hour)
SELECT
  ip_address,
  COUNT(*) as chat_count,
  MAX(created_at) as last_chat
FROM anonymous_chat_logs
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY ip_address
ORDER BY chat_count DESC
LIMIT 20;

-- Rate limit violations (>5 chats per hour per IP)
SELECT
  ip_address,
  COUNT(*) as chat_count
FROM anonymous_chat_logs
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY ip_address
HAVING COUNT(*) > 5
ORDER BY chat_count DESC;
```

### User Rate Limiting

```sql
-- Users exceeding rate limits (last hour)
SELECT
  user_id,
  COUNT(*) as generation_count
FROM generations
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY user_id
HAVING COUNT(*) > 50
ORDER BY generation_count DESC;
```

## Deployment Monitoring

### Deployment Status

```sql
-- Recent deployments
SELECT
  id,
  user_id,
  platform,
  status,
  url,
  created_at,
  updated_at
FROM deployments
ORDER BY created_at DESC
LIMIT 50;

-- Deployment success rate (last 7 days)
SELECT
  platform,
  COUNT(*) as total_deployments,
  SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) as successful,
  ROUND(100.0 * SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate
FROM deployments
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY platform;

-- Deployment errors (last 24 hours)
SELECT
  platform,
  status,
  metadata->>'error' as error_message,
  created_at
FROM deployments
WHERE status = 'error'
  AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;
```

## Database Maintenance

### Table Sizes

```sql
-- Table sizes
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
  pg_total_relation_size(schemaname||'.'||tablename) AS size_bytes
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY size_bytes DESC;

-- Index usage
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan as index_scans,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC
LIMIT 20;
```

### Data Growth

```sql
-- Record counts by table
SELECT
  'users' as table_name,
  COUNT(*) as record_count
FROM users
UNION ALL
SELECT 'chats', COUNT(*) FROM chats
UNION ALL
SELECT 'messages', COUNT(*) FROM messages
UNION ALL
SELECT 'generations', COUNT(*) FROM generations
UNION ALL
SELECT 'error_logs', COUNT(*) FROM error_logs
UNION ALL
SELECT 'deployments', COUNT(*) FROM deployments
ORDER BY record_count DESC;

-- Data growth rate (last 30 days)
SELECT
  DATE(created_at) as date,
  COUNT(*) as new_chats
FROM chats
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY date
ORDER BY date DESC;
```

## Cleanup & Maintenance Queries

### Old Data Cleanup

```sql
-- Count old error logs (>30 days)
SELECT COUNT(*)
FROM error_logs
WHERE timestamp < NOW() - INTERVAL '30 days';

-- Delete old error logs (USE WITH CAUTION)
-- DELETE FROM error_logs
-- WHERE timestamp < NOW() - INTERVAL '30 days';

-- Count old anonymous chat logs (>7 days)
SELECT COUNT(*)
FROM anonymous_chat_logs
WHERE created_at < NOW() - INTERVAL '7 days';

-- Delete old anonymous chat logs (USE WITH CAUTION)
-- DELETE FROM anonymous_chat_logs
-- WHERE created_at < NOW() - INTERVAL '7 days';
```

### Vacuum and Analyze

```sql
-- Vacuum analyze critical tables
VACUUM ANALYZE error_logs;
VACUUM ANALYZE generations;
VACUUM ANALYZE chats;
VACUUM ANALYZE messages;
VACUUM ANALYZE deployments;
```

## Alert Conditions

### Critical Alerts

```sql
-- High error rate (>10 errors in last 5 minutes)
SELECT COUNT(*) as error_count
FROM error_logs
WHERE timestamp > NOW() - INTERVAL '5 minutes'
  AND level IN ('error', 'fatal');

-- Database connection pool exhaustion
SELECT COUNT(*) as active_connections
FROM pg_stat_activity
WHERE state = 'active';

-- Slow queries (>5 seconds average in last hour)
SELECT AVG(generation_time_ms) as avg_generation_time
FROM generations
WHERE created_at > NOW() - INTERVAL '1 hour';
```

### Warning Alerts

```sql
-- Moderate error rate (>20 errors in last hour)
SELECT COUNT(*) as error_count
FROM error_logs
WHERE timestamp > NOW() - INTERVAL '1 hour'
  AND level IN ('error', 'fatal');

-- High deployment failure rate
SELECT
  COUNT(*) FILTER (WHERE status = 'error') as failures,
  COUNT(*) as total
FROM deployments
WHERE created_at > NOW() - INTERVAL '1 hour';
```

## Custom Dashboards

### Executive Summary

```sql
-- Last 24 hours summary
SELECT
  (SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL '24 hours') as new_users,
  (SELECT COUNT(DISTINCT user_id) FROM generations WHERE created_at > NOW() - INTERVAL '24 hours') as active_users,
  (SELECT COUNT(*) FROM generations WHERE created_at > NOW() - INTERVAL '24 hours') as total_generations,
  (SELECT AVG(generation_time_ms) FROM generations WHERE created_at > NOW() - INTERVAL '24 hours') as avg_generation_time,
  (SELECT COUNT(*) FROM error_logs WHERE timestamp > NOW() - INTERVAL '24 hours' AND level IN ('error', 'fatal')) as total_errors,
  (SELECT COUNT(*) FROM deployments WHERE created_at > NOW() - INTERVAL '24 hours' AND status = 'ready') as successful_deployments;
```

### Model Performance Comparison

```sql
SELECT
  model,
  COUNT(*) as generations,
  ROUND(AVG(generation_time_ms)) as avg_ms,
  ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY generation_time_ms)) as p95_ms
FROM generations
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY model
ORDER BY generations DESC;
```

## Monitoring Best Practices

1. **Set up automated alerts** for critical conditions
2. **Monitor error rates** continuously
3. **Track performance trends** over time
4. **Review slow queries** weekly
5. **Clean up old data** regularly
6. **Vacuum tables** periodically
7. **Monitor database size** and growth
8. **Track user engagement** metrics
9. **Review deployment success rates**
10. **Keep these queries updated** as schema evolves
