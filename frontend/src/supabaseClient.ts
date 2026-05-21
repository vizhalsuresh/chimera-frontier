import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('MISSING_SUPABASE_CREDENTIALS: Check your .env file or Vercel Environment Variables.')
}

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '')

