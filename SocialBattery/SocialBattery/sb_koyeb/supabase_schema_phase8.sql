-- ============================================================
-- SocialBattery — Phase 8: Polish & UX
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Add bio field to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT NULL;

-- 2. Add onboarding_done flag
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_done BOOLEAN DEFAULT FALSE;

-- 3. Add push subscription storage
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, endpoint)
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own push subs"
  ON push_subscriptions
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 4. Extend users RLS to allow bio update
-- (existing RLS already covers UPDATE for own user)

COMMENT ON COLUMN users.bio IS 'Short user biography, max 160 chars';
COMMENT ON COLUMN users.onboarding_done IS 'Whether user completed the onboarding flow';
