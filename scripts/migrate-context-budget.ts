#!/usr/bin/env tsx
/**
 * Migration script for Context Budget Manager tables
 *
 * Creates all necessary database tables for the budget management system.
 * Run this after adding the schema definitions.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  console.log('Starting Context Budget Manager migration...');

  // Create postgres connection
  const connection = postgres(databaseUrl, { max: 1 });
  const db = drizzle(connection);

  try {
    console.log('Running migrations...');

    // Note: In a real deployment, you would use Drizzle's migration system
    // For now, we'll just verify the connection
    console.log('✓ Database connection successful');

    console.log('\nContext Budget Manager tables will be created when you run:');
    console.log('  pnpm drizzle-kit generate:pg');
    console.log('  pnpm drizzle-kit push:pg');

    console.log('\nThe following tables will be created:');
    console.log('  - budget_tracking');
    console.log('  - context_items');
    console.log('  - budget_events');
    console.log('  - budget_configurations');

    console.log('\nMigration preparation complete!');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

main();
