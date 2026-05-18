import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import mqtt from 'npm:mqtt'

const MQTT_HOST = "mqtt.miraie.in";
const MQTT_PORT = 8883;

const _MODE_MAP = { "auto": 0, "cool": 1, "heat": 2, "dry": 3, "fan": 4 };
const _FAN_MAP = { "auto": 0, "low": 1, "medium": 2, "high": 3 };

function buildPayload(action: string, acState: any) {
  return JSON.stringify({
    "ki": 1,
    "cnt": "an",
    "sid": "1",
    "ps": action === "on" ? "on" : "off",
    "tm": acState.temp || 22,
    "md": _MODE_MAP[acState.mode] ?? 1,
    "fs": _FAN_MAP[acState.fan] ?? 0,
    "sv": acState.swing_v ? "auto" : String(acState.swing_angle || 3),
    "sh": acState.swing_h ? "auto" : "stop",
    "tt": acState.powerful ? "on" : "off",
    "ec": (acState.eco && !acState.powerful) ? "on" : "off",
    "qt": acState.quiet ? "on" : "off",
    "na": acState.nanoe ? "on" : "off",
  });
}

Deno.serve(async (req) => {
  try {
    const { user_id, action, device_index = 0 } = await req.json()

    if (!user_id || !action) {
      return new Response(JSON.stringify({ error: 'user_id and action required' }), { status: 400 })
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Fetch auth data
    const { data: authData, error: authError } = await supabaseClient
      .from('miraie_auth')
      .select('*')
      .eq('user_id', user_id)
      .single()

    if (authError || !authData) {
      return new Response(JSON.stringify({ error: 'Miraie auth not found for user', detail: authError }), { status: 404 })
    }

    // 2. Fetch AC state
    const { data: acState, error: stateError } = await supabaseClient
      .from('ac_state')
      .select('*')
      .eq('user_id', user_id)
      .single()

    // Fallback to defaults if no state found
    const state = acState || { temp: 22, mode: 'cool', fan: 'auto', swing_v: true };

    const device = authData.devices[device_index];
    if (!device) {
      return new Response(JSON.stringify({ error: 'Device not found at index ' + device_index }), { status: 404 })
    }

    const payload = buildPayload(action, state);
    const topic = device.control_topic;

    // 3. Connect to MQTT and Publish
    return new Promise((resolve) => {
      const client = mqtt.connect(`mqtts://${MQTT_HOST}:${MQTT_PORT}`, {
        username: authData.home_id,
        password: authData.access_token,
        rejectUnauthorized: false, // Miraie cert might be problematic in some envs, but let's try
      });

      client.on('connect', () => {
        console.log('Connected to Miraie MQTT');
        client.publish(topic, payload, { qos: 1 }, (err) => {
          if (err) {
            console.error('Publish error:', err);
            client.end();
            resolve(new Response(JSON.stringify({ error: 'MQTT publish failed', detail: err }), { status: 500 }));
          } else {
            console.log(`Published ${action} to ${topic}`);
            client.end();
            resolve(new Response(JSON.stringify({ message: `Successfully sent ${action} command` }), { status: 200 }));
          }
        });
      });

      client.on('error', (err) => {
        console.error('MQTT connection error:', err);
        client.end();
        resolve(new Response(JSON.stringify({ error: 'MQTT connection failed', detail: err.message }), { status: 500 }));
      });

      // Timeout safety
      setTimeout(() => {
        client.end();
        resolve(new Response(JSON.stringify({ error: 'MQTT connection timed out' }), { status: 504 }));
      }, 10000);
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }
})
