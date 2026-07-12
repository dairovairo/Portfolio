-- ============================================================
-- SocialBattery — Phase 87: Corrección de typo "comunity" → "community"
-- Run this in Supabase SQL Editor
-- ============================================================
-- La fase 82 introdujo por error el tier de sorteo con la clave mal
-- escrita "comunity". Esta migración corrige tanto los datos ya
-- guardados como el CHECK constraint para que use "community".

-- 1) Quitar el CHECK constraint antiguo (que solo permitía 'comunity')
ALTER TABLE public.community_raffles
  DROP CONSTRAINT IF EXISTS community_raffles_tier_check;

-- 2) Actualizar las filas existentes que usaban la clave mal escrita
UPDATE public.community_raffles
  SET tier = 'community'
  WHERE tier = 'comunity';

-- 3) Volver a crear el CHECK constraint con la clave corregida
ALTER TABLE public.community_raffles
  ADD CONSTRAINT community_raffles_tier_check
    CHECK (tier IN ('light', 'volt', 'community'));

NOTIFY pgrst, 'reload schema';
