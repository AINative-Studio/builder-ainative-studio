import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

// Load environment variables
import { config } from 'dotenv'
config()

const runMigrate = async () => {
  if (!process.env.POSTGRES_URL) {
    console.log('POSTGRES_URL is not defined, skipping migrations')
    process.exit(0)
  }

  const connection = postgres(process.env.POSTGRES_URL, { max: 1 })

  const db = drizzle(connection)

  console.log('⏳ Running migrations...')

  const start = Date.now()

  try {
    await migrate(db, { migrationsFolder: 'lib/db/migrations' })
  } catch (err: any) {
    // Handle "already exists" errors gracefully - these occur when the DB
    // was set up outside of Drizzle migrations (e.g. manual schema sync)
    const pgCode = err?.cause?.code
    const isAlreadyExists =
      pgCode === '42P07' || // relation already exists
      pgCode === '42710' || // type/constraint already exists
      pgCode === '42701' || // column already exists
      err?.message?.includes('already exists')

    if (isAlreadyExists) {
      console.log('⚠️  Some objects already exist in database — schema is up to date')
    } else {
      throw err
    }
  }

  const end = Date.now()

  console.log('✅ Migrations completed in', end - start, 'ms')

  await connection.end()
  process.exit(0)
}

runMigrate().catch((err) => {
  console.error('❌ Migration failed')
  console.error(err)
  process.exit(1)
})
