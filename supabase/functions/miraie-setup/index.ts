import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CLIENT_ID = Deno.env.get("MIRAIE_CLIENT_ID") || "PBcMcfG19njNCL8AOgvRzIC8AjQa";
const LOGIN_URL = "https://auth.miraie.in/simplifi/v1/userManagement/login";
const HOMES_URL = "https://app.miraie.in/simplifi/v1/homeManagement/homes";

Deno.serve(async (req) => {
  try {
    const { mobile, password } = await req.json()

    if (!mobile || !password) {
      return new Response(JSON.stringify({ error: 'Mobile and password required' }), { 
        status: 400,
        headers: { "Content-Type": "application/json" }
      })
    }

    // 1. Login to Miraie
    const loginResp = await fetch(LOGIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: CLIENT_ID,
        mobile: mobile,
        password: password,
        scope: `an_${Math.floor(Math.random() * 900000000) + 100000000}`,
      }),
    })

    if (!loginResp.ok) {
      const err = await loginResp.text()
      return new Response(JSON.stringify({ error: 'Miraie login failed', detail: err }), { 
        status: 401,
        headers: { "Content-Type": "application/json" }
      })
    }

    const authData = await loginResp.json()
    const token = authData.accessToken

    // 2. Get Devices
    const homesResp = await fetch(HOMES_URL, {
      headers: { 'Authorization': `Bearer ${token}` }
    })

    if (!homesResp.ok) {
        return new Response(JSON.stringify({ error: 'Failed to fetch homes' }), { 
          status: 500,
          headers: { "Content-Type": "application/json" }
        })
    }

    const homes = await homesResp.json()
    const devices = []
    if (homes && homes.length > 0) {
      for (const space of homes[0].spaces || []) {
        for (const d of space.devices || []) {
          devices.push({
            name: d.deviceName,
            id: d.deviceId,
            topic: d.topic[0],
            control_topic: d.topic[0] + "/control",
          })
        }
      }
    }
    const homeId = homes[0]?.homeId

    // 3. Save to DB
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Try to get user from Auth header
    const authHeader = req.headers.get('Authorization')
    let userId = null
    if (authHeader) {
      const { data: { user }, error: authError } = await supabaseClient.auth.getUser(authHeader.replace('Bearer ', ''))
      if (authError) console.error('Auth check failed:', authError)
      userId = user?.id
    }

    if (!userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Missing or invalid Supabase token. Please log in again.' }), { 
        status: 401,
        headers: { "Content-Type": "application/json" }
      })
    }

    const { error: dbError } = await supabaseClient
      .from('miraie_auth')
      .upsert({
        user_id: userId,
        mobile: mobile,
        access_token: token,
        refresh_token: authData.refreshToken,
        home_id: homeId,
        devices: devices
      }, { onConflict: 'user_id' })

    if (dbError) {
      return new Response(JSON.stringify({ error: 'Database update failed', detail: dbError }), { 
        status: 500,
        headers: { "Content-Type": "application/json" }
      })
    }

    return new Response(JSON.stringify({ message: 'Setup successful', devices, homeId }), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500,
      headers: { "Content-Type": "application/json" }
    })
  }
})
