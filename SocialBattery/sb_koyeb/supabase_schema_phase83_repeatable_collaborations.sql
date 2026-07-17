-- ============================================================
-- SocialBattery — Phase 83: Colaboraciones repetibles
-- Run this in Supabase SQL Editor
-- ============================================================
-- Antes solo se permitía una colaboración por usuario y comunidad
-- (UNIQUE community_id, user_id). Ahora un usuario puede colaborar
-- varias veces (cada colaboración queda registrada como una fila
-- nueva); lo único que se conserva es que, en cuanto colabora una
-- vez, queda marcado como "colaborador" de esa comunidad para
-- siempre (esto ya lo calcula el backend comprobando si existe al
-- menos una fila en community_collaborations, así que no requiere
-- columna extra).

ALTER TABLE public.community_collaborations
  DROP CONSTRAINT IF EXISTS community_collaborations_community_id_user_id_key;

-- El índice de lectura por comunidad/fecha se mantiene tal cual
-- (creado en la fase 81), sigue siendo útil sin el UNIQUE.

NOTIFY pgrst, 'reload schema';
