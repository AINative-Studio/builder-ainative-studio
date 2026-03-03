import 'dotenv/config'
import { hash } from 'bcrypt-ts'
import { db } from '../lib/db/connection'
import { users } from '../lib/db/schema'
import { eq } from 'drizzle-orm'

async function createAdminUser() {
  const email = 'admin@ainative.studio'
  const password = 'ainative123' // Change this to your secure password

  try {
    // Check if user already exists
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1)

    if (existingUser.length > 0) {
      console.log(`✅ User ${email} already exists`)
      console.log('User ID:', existingUser[0].id)
      return
    }

    // Hash the password
    const hashedPassword = await hash(password, 10)

    // Create the user
    const [newUser] = await db
      .insert(users)
      .values({
        email,
        password: hashedPassword,
      })
      .returning()

    console.log('✅ Admin user created successfully!')
    console.log('Email:', email)
    console.log('Password:', password)
    console.log('User ID:', newUser.id)
    console.log('\n⚠️  IMPORTANT: Change the password after first login!')

  } catch (error) {
    console.error('❌ Error creating admin user:', error)
    throw error
  }
}

createAdminUser()
  .then(() => {
    console.log('\n✅ Script completed')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error)
    process.exit(1)
  })
