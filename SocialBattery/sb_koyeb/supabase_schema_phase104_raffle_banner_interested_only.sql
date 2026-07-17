-- ============================================================
-- SocialBattery — Phase 104: Filtro "solo interesados" (Sorteo Light)
-- Run this in Supabase SQL Editor
-- ============================================================
-- En la configuración de publicidad de un sorteo Light (ver
-- RaffleAdAudiencePage.jsx) se puede elegir contratar las visualizaciones
-- de banner solo entre los usuarios "interesados" (cuyos intereses de
-- perfil se cruzan con las categorías de la comunidad) en vez de entre
-- todos los usuarios notificables. Se guarda aquí para que quede
-- registrado con qué audiencia se contrató el sorteo.

ALTER TABLE public.community_raffles
  ADD COLUMN IF NOT EXISTS banner_interested_only BOOLEAN NOT NULL DEFAULT FALSE;

NOTIFY pgrst, 'reload schema';
