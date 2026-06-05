-- ============================================================
-- PHASE 28: Group Message Push Notification Fix
-- Run this in the Supabase SQL Editor if not already done.
-- ============================================================

-- Ensure group_messages and friend_groups are in the realtime publication
-- (this may already be done via supabase_schema_realtime_groups_fix.sql)
ALTER PUBLICATION supabase_realtime ADD TABLE public.group_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.friend_groups;
ALTER PUBLICATION supabase_realtime ADD TABLE public.friend_group_members;

-- Ensure push_subscriptions table exists (required for server-side push fan-out)
-- Skip if it already exists from phase 26.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can manage own subscriptions" ON push_subscriptions
  FOR ALL USING (user_id = auth.uid());
