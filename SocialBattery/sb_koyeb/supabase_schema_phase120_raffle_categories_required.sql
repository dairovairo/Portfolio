-- ══════════════════════════════════════════════════
--  SocialBattery — Fase 120: Categorías obligatorias en sorteos
--  Run this in: Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════
-- Complemento a la fase 116 (hasta 3 categorías por sorteo). Ahora se
-- exige al menos una categoría — sin categorías no hay forma de que un
-- sorteo aparezca en la vista de "Actividades → Sorteos" cuando el
-- usuario filtra por intereses o por categoría, y tampoco se puede
-- calcular la audiencia de publicidad interesada.
--
-- CUIDADO al aplicarlo si hay sorteos históricos sin categorías: la
-- constraint fallará. La consulta comentada de abajo devuelve los
-- sorteos afectados; hay que asignarles alguna categoría (o borrarlos
-- si ya se han sorteado y no interesan) antes de correr el ALTER.
--
--   SELECT id, community_id, title, categories
--     FROM public.community_raffles
--    WHERE COALESCE(array_length(categories, 1), 0) = 0;

ALTER TABLE public.community_raffles
  DROP CONSTRAINT IF EXISTS community_raffles_categories_min1;
ALTER TABLE public.community_raffles
  ADD CONSTRAINT community_raffles_categories_min1
  CHECK (COALESCE(array_length(categories, 1), 0) >= 1);

COMMENT ON COLUMN public.community_raffles.categories IS
  'Entre 1 y 3 categorías de interés del sorteo. Mismo listado que eventos/comunidades (src/constants/categories.js).';

NOTIFY pgrst, 'reload schema';
