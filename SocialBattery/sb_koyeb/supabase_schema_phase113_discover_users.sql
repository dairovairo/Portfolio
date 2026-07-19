-- ============================================================
-- SocialBattery — Phase 113: Descubrir usuarios (cercanía + amigos en común)
-- Run this in Supabase SQL Editor
-- ============================================================

-- Privacidad: si es false, el usuario no aparece en "Descubrir" de nadie
-- (ni en "Cerca de ti" ni en "Quizás conozcas"), aunque tenga home_lat/lng
-- guardadas o amigos en común con otros. Mismo patrón que show_interests /
-- show_public_stats (Phase 29).
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS discoverable boolean NOT NULL DEFAULT true;
