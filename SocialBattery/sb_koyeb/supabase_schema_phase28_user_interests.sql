-- ══════════════════════════════════════════════════
--  SocialBattery — Fase 28: Intereses de usuario
--  Run this in: Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════

-- Añade columna interests (array de texto) a la tabla users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS interests TEXT[] NOT NULL DEFAULT '{}';

-- Comentario descriptivo
COMMENT ON COLUMN public.users.interests IS
  'Categorías de interés del usuario, elegidas durante el onboarding. Mismas categorías que en comunidades y eventos.';
