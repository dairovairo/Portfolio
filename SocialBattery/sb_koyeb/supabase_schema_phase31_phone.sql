-- ══════════════════════════════════════════════════
--  SocialBattery — Phase 31: Phone number for contacts
--  Run this in: Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════

-- Add phone field to users (optional, user sets it in settings)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone TEXT;

-- Index for fast phone lookups (used by contacts feature)
CREATE INDEX IF NOT EXISTS idx_users_phone ON public.users(phone) WHERE phone IS NOT NULL;
