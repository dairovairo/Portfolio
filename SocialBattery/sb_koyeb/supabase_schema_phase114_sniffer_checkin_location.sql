-- ============================================================
-- SocialBattery — Phase 114: Ubicación del check-in del Sniffer
-- Run this in Supabase SQL Editor
-- ============================================================
-- Hasta ahora pool_sniffer_checkins (fase 101) solo guardaba QUIÉN llegó y
-- CUÁNDO, no DÓNDE — el lat/lng que manda el cliente al marcar "Estoy
-- dentro" solo se usaba para validar la distancia contra el punto de la
-- quedada (pool.lat/lng) y se descartaba después.
--
-- Para poder pintar la mascota + foto de cada usuario en el mapa del
-- Sniffer una vez entra en el círculo verde (PoolSnifferPage.jsx), hace
-- falta persistir esa posición. Se guarda tal cual llegó en el check-in
-- (un único punto, no seguimiento en vivo como el Locator de eventos) —
-- coherente con que el Sniffer es un "ping" puntual, no tracking continuo.

ALTER TABLE public.pool_sniffer_checkins
  ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;

NOTIFY pgrst, 'reload schema';
