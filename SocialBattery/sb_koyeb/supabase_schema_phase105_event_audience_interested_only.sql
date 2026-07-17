-- ============================================================
-- SocialBattery — Phase 105: Filtro "solo interesados" (Promoción Premium/Ultra)
-- Run this in Supabase SQL Editor
-- ============================================================
-- En la configuración de publicidad de un evento Premium/Ultra (ver
-- EventAdConfigPage.jsx) se puede elegir contratar las notificaciones
-- solo entre los usuarios "interesados" (cuyos intereses de perfil se
-- cruzan con las categorías del evento) en vez de entre todos los
-- notificables. Se guarda aquí para que server/jobs/eventPromoPacing.js
-- pueda restringir el pool de candidatos a ese subconjunto, y para que
-- quede registrado con qué audiencia se contrató la promoción.

ALTER TABLE public.community_events
  ADD COLUMN IF NOT EXISTS audience_interested_only BOOLEAN NOT NULL DEFAULT FALSE;

NOTIFY pgrst, 'reload schema';
