import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import mqtt from 'npm:mqtt'

const MQTT_HOST = "mqtt.miraie.in";
const MQTT_PORT = 8883;

const _MODE_MAP = { "auto": 0, "cool": 1, "heat": 2, "dry": 3, "fan": 4 };
const _FAN_MAP = { "auto": 0, "low": 1, "medium": 2, "high": 3 };
const _MODE_MAP_REV = { 0: "auto", 1: "cool", 2: "heat", 3: "dry", 4: "fan" };
const _FAN_MAP_REV = { 0: "auto", 1: "low", 2: "medium", 3: "high" };

function buildPayload(action: string, acState: any) {
  if (action === "status_request") {
    return JSON.stringify({ "ki": 1, "cnt": "an", "sid": "1", "type": "status_request" });
  }
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

function parseStatus(data: any) {
  const state: any = {};
  if ("ps" in data) state.power = data.ps === "on";
  if ("tm" in data) state.temp = parseInt(data.tm);
  if ("md" in data) state.mode = _MODE_MAP_REV[parseInt(data.md)] || "cool";
  if ("fs" in data) state.fan = _FAN_MAP_REV[parseInt(data.fs)] || "auto";
  if ("sv" in data) state.swing_v = data.sv === "auto";
  if ("sh" in data) state.swing_h = data.sh === "auto";
  if ("ec" in data) state.eco = data.ec === "on";
  if ("tt" in data) state.powerful = data.tt === "on";
  if ("na" in data) state.nanoe = data.na === "on";
  if ("qt" in data) state.quiet = data.qt === "on";
  return state;
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

    const device = authData.devices[device_index];
    if (!device) {
      return new Response(JSON.stringify({ error: 'Device not found at index ' + device_index }), { status: 404 })
    }

    // 2. Handle Action
    if (action === "status_request") {
      const topic = device.topic; // telemetry topic
      const controlTopic = device.control_topic;
      const payload = buildPayload(action, {});

      return new Promise((resolve) => {
        const client = mqtt.connect(`mqtts://${MQTT_HOST}:${MQTT_PORT}`, {
          username: authData.home_id,
          password: authData.access_token,
          rejectUnauthorized: false,
        });

        client.on('connect', () => {
          client.subscribe(topic);
          client.publish(controlTopic, payload);
        });

        client.on('message', async (t, m) => {
          if (t === topic) {
            const data = JSON.parse(m.toString());
            const newState = parseStatus(data);
            if (Object.keys(newState).length > 0) {
              await supabaseClient.from('ac_state').upsert({
                user_id,
                ...newState,
                updated_at: new Date().toISOString()
              }, { onConflict: 'user_id' });
              
              client.end();
              resolve(new Response(JSON.stringify({ message: 'Sync successful', state: newState }), { status: 200 }));
            }
          }
        });

        setTimeout(() => {
          client.end();
          resolve(new Response(JSON.stringify({ error: 'Sync timed out' }), { status: 504 }));
        }, 8000);
      });
    }

    // 3. Fetch current AC state for command
    const { data: acState } = await supabaseClient
      .from('ac_state')
      .select('*')
      .eq('user_id', user_id)
      .single()

    const state = acState || { temp: 22, mode: 'cool', fan: 'auto', swing_v: true };
    const payload = buildPayload(action, state);
    const topic = device.control_topic;

    // 4. Connect to MQTT and Publish
    return new Promise((resolve) => {
      const client = mqtt.connect(`mqtts://${MQTT_HOST}:${MQTT_PORT}`, {
        username: authData.home_id,
        password: authData.access_token,
        rejectUnauthorized: false,
      });

      client.on('connect', () => {
        client.publish(topic, payload, { qos: 1 }, (err) => {
          if (err) {
            client.end();
            resolve(new Response(JSON.stringify({ error: 'MQTT publish failed', detail: err }), { status: 500 }));
          } else {
            client.end();
            resolve(new Response(JSON.stringify({ message: `Successfully sent ${action} command` }), { status: 200 }));
          }
        });
      });

      client.on('error', (err) => {
        client.end();
        resolve(new Response(JSON.stringify({ error: 'MQTT connection failed', detail: err.message }), { status: 500 }));
      });

      setTimeout(() => {
        client.end();
        resolve(new Response(JSON.stringify({ error: 'MQTT connection timed out' }), { status: 504 }));
      }, 10000);
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }
})

