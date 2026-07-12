-- ============================================================
-- SocialBattery — Phase 88: Silenciar chats de grupo, quedadas y comunidades
-- Run this in Supabase SQL Editor
-- ============================================================
-- Permite a cada usuario silenciar, de forma individual, las
-- notificaciones de un grupo privado, una quedada (pool) o una
-- comunidad concretos, sin afectar a los demás miembros. Se controla
-- desde el menú (⋯) de cada chat.

ALTER TABLE public.friend_group_members
  ADD COLUMN IF NOT EXISTS muted BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.pool_participants
  ADD COLUMN IF NOT EXISTS muted BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.community_members
  ADD COLUMN IF NOT EXISTS muted BOOLEAN NOT NULL DEFAULT FALSE;

NOTIFY pgrst, 'reload schema';
