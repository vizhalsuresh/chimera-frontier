-- Create miraie_auth table
CREATE TABLE IF NOT EXISTS public.miraie_auth (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users NOT NULL UNIQUE,
    mobile text,
    access_token text,
    refresh_token text,
    home_id text,
    devices jsonb,
    updated_at timestamptz DEFAULT now()
);

-- Create ac_state table
CREATE TABLE IF NOT EXISTS public.ac_state (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users NOT NULL,
    temp int DEFAULT 22,
    mode text DEFAULT 'cool',
    fan text DEFAULT 'auto',
    updated_at timestamptz DEFAULT now()
);

-- Create schedules table
CREATE TABLE IF NOT EXISTS public.schedules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users NOT NULL,
    time text,
    action text,
    days text[],
    enabled boolean DEFAULT true,
    created_at timestamptz DEFAULT now()
);

-- Create config table
CREATE TABLE IF NOT EXISTS public.config (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users NOT NULL,
    key text NOT NULL,
    value text,
    updated_at timestamptz DEFAULT now(),
    UNIQUE(user_id, key)
);

-- Create schedule_profiles table
CREATE TABLE IF NOT EXISTS public.schedule_profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users NOT NULL,
    name text NOT NULL,
    schedules jsonb,
    updated_at timestamptz DEFAULT now(),
    UNIQUE(user_id, name)
);

-- Create timers table
CREATE TABLE IF NOT EXISTS public.timers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users NOT NULL,
    timer_id text NOT NULL,
    hours int,
    minutes int,
    created_at timestamptz DEFAULT now(),
    UNIQUE(user_id, timer_id)
);

-- Create ac_profiles table
CREATE TABLE IF NOT EXISTS public.ac_profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users NOT NULL,
    name text NOT NULL,
    temp int,
    mode text,
    fan text,
    updated_at timestamptz DEFAULT now(),
    UNIQUE(user_id, name)
);

-- Create logs table
CREATE TABLE IF NOT EXISTS public.logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users NOT NULL,
    source text,
    message text,
    created_at timestamptz DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.miraie_auth ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ac_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ac_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can manage their own miraie_auth" ON public.miraie_auth FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage their own ac_state" ON public.ac_state FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage their own schedules" ON public.schedules FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage their own config" ON public.config FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage their own schedule_profiles" ON public.schedule_profiles FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage their own timers" ON public.timers FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage their own ac_profiles" ON public.ac_profiles FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage their own logs" ON public.logs FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);


