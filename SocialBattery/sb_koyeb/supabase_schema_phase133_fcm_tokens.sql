-- ============================================================
-- SocialBattery — Phase 133: FCM device tokens (Android/iOS native push)
-- Run this in Supabase SQL Editor
-- ============================================================
--
-- Web Push (push_subscriptions, phase 8) depends on the browser Push API,
-- which Android's WebView (used by the Capacitor mobile wrapper) does not
-- reliably deliver in the background. This table stores Firebase Cloud
-- Messaging device tokens registered by the native app instead — see
-- server/lib/fcm.js and client/src/lib/capacitorPush.js.

CREATE TABLE IF NOT EXISTS fcm_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL,
  platform    TEXT NOT NULL DEFAULT 'android',
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(token)
);

CREATE INDEX IF NOT EXISTS fcm_tokens_user_id_idx ON fcm_tokens(user_id);

ALTER TABLE fcm_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own fcm tokens"
  ON fcm_tokens
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE fcm_tokens IS 'Firebase Cloud Messaging device tokens for the native Android/iOS app (Capacitor push-notifications), used to reach the app when backgrounded/closed.';
COMMENT ON COLUMN fcm_tokens.token IS 'FCM registration token — unique per device+app install, reassigned to whoever last registered on that device (same pattern as push_subscriptions.endpoint).';
