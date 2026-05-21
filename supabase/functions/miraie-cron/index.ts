import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Calculate current time rounded to 5 mins in UTC
    const now = new Date()
    const utcMinutes = now.getUTCMinutes()
    const roundedMinutes = Math.round(utcMinutes / 5) * 5
    
    let hours = now.getUTCHours()
    let displayMinutes = roundedMinutes
    
    if (roundedMinutes === 60) {
      displayMinutes = 0
      hours = (hours + 1) % 24
    }

    const timeStr = `${hours.toString().padStart(2, '0')}:${displayMinutes.toString().padStart(2, '0')}`
    
    // Day abbreviation (Mon, Tue, ...)
    const dayAbbr = new Intl.DateTimeFormat('en-US', { 
      weekday: 'short', 
      timeZone: 'UTC' 
    }).format(now);

    console.log(`Checking schedules for UTC ${timeStr} on ${dayAbbr}`)

    // --- NEW: Status Sync Logic ---
    // Trigger a state sync for all active users every cron tick
    const { data: allUsers } = await supabaseClient.from('miraie_auth').select('user_id')
    if (allUsers) {
      for (const u of allUsers) {
        console.log(`Triggering state sync for user ${u.user_id}`)
        // We trigger it asynchronously and don't wait, to keep cron fast
        fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/miraie-worker`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
          },
          body: JSON.stringify({
            user_id: u.user_id,
            action: 'status_request' // New action type for worker
          })
        }).catch(err => console.error(`Sync trigger failed for ${u.user_id}:`, err))
      }
    }
    // ------------------------------

    // Query matching schedules
    const { data: schedules, error } = await supabaseClient
      .from('schedules')
      .select('*')
      .eq('enabled', true)
      .eq('time', timeStr)
      // Check if current day is in the days array
      .contains('days', [dayAbbr]) 

    if (error) {
      console.error('Schedule query error:', error)
      return new Response(JSON.stringify({ error: 'Failed to fetch schedules', detail: error }), { status: 500 })
    }

    if (!schedules || schedules.length === 0) {
      return new Response(JSON.stringify({ message: `No schedules to fire for ${timeStr}` }), { status: 200 })
    }

    const workerUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/miraie-worker`
    const results = []

    for (const schedule of schedules) {
      console.log(`Firing schedule ${schedule.id} for user ${schedule.user_id}: ${schedule.action}`)
      
      try {
        const resp = await fetch(workerUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
          },
          body: JSON.stringify({
            user_id: schedule.user_id,
            action: schedule.action
          })
        })

        const workerData = await resp.json()
        results.push({
          schedule_id: schedule.id,
          status: resp.status,
          data: workerData
        })
      } catch (workerErr) {
        console.error(`Worker call failed for schedule ${schedule.id}:`, workerErr)
        results.push({
          schedule_id: schedule.id,
          error: workerErr.message
        })
      }
    }

    return new Response(JSON.stringify({ 
      message: `Processed ${schedules.length} schedules`, 
      time_checked: timeStr,
      results 
    }), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500,
      headers: { "Content-Type": "application/json" }
    })
  }
})
