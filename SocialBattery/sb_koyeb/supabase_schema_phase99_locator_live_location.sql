-- ============================================================
-- SocialBattery — Phase 99: Ubicación en vivo del grupo de localización
-- Run this in Supabase SQL Editor
-- ============================================================
-- Añade la posición actual de cada miembro ACEPTADO del grupo de
-- localización de un evento (fase 98). El cliente (EventLocatorPage.jsx)
-- hace watchPosition() mientras la página está abierta y hace throttle de
-- POST /events/:id/locator/location; el servidor persiste la última
-- posición aquí (para quien entra más tarde) y además retransmite un
-- broadcast de Realtime al canal `locator-group-<groupId>` para
-- actualización instantánea sin depender de un refetch.

ALTER TABLE public.event_locator_group_members
  ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMPTZ;

NOTIFY pgrst, 'reload schema';
