-- Phase 17: event covers and 24h battery expiry

ALTER TABLE public.community_events
  ADD COLUMN IF NOT EXISTS cover_image_url TEXT;

UPDATE public.users
SET battery_level = 0,
    battery_is_estimated = FALSE
WHERE battery_level <> 0
  AND (
    battery_updated_at IS NULL
    OR battery_updated_at < NOW() - INTERVAL '24 hours'
  );
