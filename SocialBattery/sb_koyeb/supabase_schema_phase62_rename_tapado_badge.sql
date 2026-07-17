-- ============================================================
-- SocialBattery — Phase 62: Renombrar insignia "Tapado" → "Average Joe/Jane"
-- Run this in Supabase SQL Editor
-- ============================================================
-- Solo cambia el nombre visible de la insignia. El id 'tapado' se
-- mantiene igual para no romper las filas ya existentes en user_badges.

UPDATE public.badges
SET name = 'Average Joe/Jane'
WHERE id = 'tapado';
