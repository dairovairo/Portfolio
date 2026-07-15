-- ══════════════════════════════════════════════════
--  SocialBattery — Fase 80: Hasta 3 categorías por evento/comunidad
--  Run this in: Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════

-- ── Eventos (community_events) ────────────────────
-- Se añade `categories` (array), que sustituye a la antigua columna
-- `category` (texto único). Aplica igual a eventos de comunidad y a
-- eventos independientes (community_id NULL): ambos usan esta tabla.
ALTER TABLE public.community_events
  ADD COLUMN IF NOT EXISTS categories TEXT[] NOT NULL DEFAULT '{}';

-- Migra los datos existentes de category -> categories
UPDATE public.community_events
SET categories = ARRAY[category]
WHERE category IS NOT NULL
  AND category <> ''
  AND categories = '{}';

ALTER TABLE public.community_events
  DROP CONSTRAINT IF EXISTS community_events_categories_max3;
ALTER TABLE public.community_events
  ADD CONSTRAINT community_events_categories_max3
  CHECK (array_length(categories, 1) IS NULL OR array_length(categories, 1) <= 3);

CREATE INDEX IF NOT EXISTS idx_community_events_categories
  ON public.community_events USING GIN (categories);

COMMENT ON COLUMN public.community_events.categories IS
  'Hasta 3 categorías de interés del evento. Sustituye a la antigua columna category (single), que se conserva sin usar por compatibilidad hacia atrás.';

-- ── Comunidades ────────────────────────────────────
ALTER TABLE public.communities
  ADD COLUMN IF NOT EXISTS categories TEXT[] NOT NULL DEFAULT '{}';

UPDATE public.communities
SET categories = ARRAY[category]
WHERE category IS NOT NULL
  AND category <> ''
  AND categories = '{}';

ALTER TABLE public.communities
  DROP CONSTRAINT IF EXISTS communities_categories_max3;
ALTER TABLE public.communities
  ADD CONSTRAINT communities_categories_max3
  CHECK (array_length(categories, 1) IS NULL OR array_length(categories, 1) <= 3);

CREATE INDEX IF NOT EXISTS idx_communities_categories
  ON public.communities USING GIN (categories);

COMMENT ON COLUMN public.communities.categories IS
  'Hasta 3 categorías de interés de la comunidad. Sustituye a la antigua columna category (single), que se conserva sin usar por compatibilidad hacia atrás.';
