const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhOWI3MTdiZS1mNDQ5LTQzYzYtYWJiNC0xOGExYTZhMGM3MGUiLCJlbWFpbCI6ImFkbWluQGFpbmF0aXZlLnN0dWRpbyIsInJvbGUiOiJBRE1JTiIsImV4cCI6MTc2MTIwMjUwNX0.nLZBsGS195YzMZl-1ZBDdYHtSnbkqk0yA-wDLSKIvyc"

async function testAINativeAuth() {
  try {
    console.log('Testing AINative authentication...\n')

    // Test with existing JWT token first
    console.log('Testing with existing JWT token...')
    const profileResponse = await fetch('https://api.ainative.studio/v1/auth/me', {
      headers: {
        'Authorization': `Bearer ${TOKEN}`
      }
    })

    if (profileResponse.ok) {
      const profileData = await profileResponse.json()
      console.log('\n✅ Existing token is valid!')
      console.log('Profile response:', JSON.stringify(profileData, null, 2))
      console.log('\nWe can use this token for authentication.')
      return { access_token: TOKEN, profile: profileData }
    } else {
      console.log('Existing token invalid, trying login...\n')
    }

    // Test 1: Login endpoint with CORRECT credentials
    const formData = new URLSearchParams()
    formData.append('username', 'admin@ainative.studio')
    formData.append('password', 'Admin2025!Secure')

    const loginResponse = await fetch('https://api.ainative.studio/v1/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData
    })

    const loginData = await loginResponse.json()
    console.log('Login response:', JSON.stringify(loginData, null, 2))
    console.log('Login status:', loginResponse.status)

    if (loginData.access_token) {
      console.log('\n✅ Authentication successful!')
      console.log('Access token:', loginData.access_token)

      // Test 2: Get user profile
      console.log('\nTesting user profile endpoint...')
      const newProfileResponse = await fetch('https://api.ainative.studio/v1/auth/me', {
        headers: {
          'Authorization': `Bearer ${loginData.access_token}`
        }
      })

      const newProfileData = await newProfileResponse.json()
      console.log('Profile response:', JSON.stringify(newProfileData, null, 2))

      return loginData
    } else {
      console.log('\n❌ Authentication failed')
    }
  } catch (error) {
    console.error('Error:', error)
  }
}

testAINativeAuth()
