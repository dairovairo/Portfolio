-- ══════════════════════════════════════════════════
--  SocialBattery — Fase 116: Hasta 3 categorías por sorteo
--  Run this in: Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════
-- Mismo patrón que supabase_schema_phase80_multi_category.sql (eventos y
-- comunidades): hasta 3 categorías por sorteo, usadas también para el
-- matching de interesados (ver getCategoryMatchingUserIds /
-- getInterestedUserIdSet en server/routes/community.js).

ALTER TABLE public.community_raffles
  ADD COLUMN IF NOT EXISTS categories TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.community_raffles
  DROP CONSTRAINT IF EXISTS community_raffles_categories_max3;
ALTER TABLE public.community_raffles
  ADD CONSTRAINT community_raffles_categories_max3
  CHECK (array_length(categories, 1) IS NULL OR array_length(categories, 1) <= 3);

CREATE INDEX IF NOT EXISTS idx_community_raffles_categories
  ON public.community_raffles USING GIN (categories);

COMMENT ON COLUMN public.community_raffles.categories IS
  'Hasta 3 categorías de interés del sorteo. Mismo listado que eventos/comunidades (src/constants/categories.js).';

NOTIFY pgrst, 'reload schema';
