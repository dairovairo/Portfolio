-- ============================================================
-- SocialBattery — Phase 106: Amplía el rango de visualizaciones
-- contratables en sorteos Light (banner_views_contracted)
-- Run this in Supabase SQL Editor
-- ============================================================
-- Antes (fase 102): 500 – 50.000. Ahora: 1.000 – 100.000. El mínimo de
-- facturación (a partir de cuántos banners enseñados se cobra) pasa a ser
-- 500 y vive solo en el frontend/documentación — NO en esta constraint,
-- que sigue limitando el rango CONTRATABLE, no el umbral de cobro.
--
-- Sorteos ya creados con el rango antiguo pueden tener
-- banner_views_contracted entre 500 y 999 (por debajo del nuevo mínimo de
-- 1.000): la nueva constraint los rechazaría, así que primero se suben al
-- nuevo mínimo (no afecta a sorteos ya finalizados: solo redefine cuántas
-- visualizaciones tenían contratadas, no cuántas se llegaron a mostrar).
UPDATE public.community_raffles
  SET banner_views_contracted = 1000
  WHERE banner_views_contracted IS NOT NULL AND banner_views_contracted < 1000;

ALTER TABLE public.community_raffles
  DROP CONSTRAINT IF EXISTS community_raffles_banner_views_contracted_check;

ALTER TABLE public.community_raffles
  ADD CONSTRAINT community_raffles_banner_views_contracted_check
    CHECK (banner_views_contracted IS NULL OR banner_views_contracted BETWEEN 1000 AND 100000);

NOTIFY pgrst, 'reload schema';
