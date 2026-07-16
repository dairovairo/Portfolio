-- Fase 110 — Filtro de audiencia por ubicación en publicidad de eventos.
--
-- Para que Premium/Ultra puedan restringir su alcance a usuarios "cerca"
-- del punto donde se organiza el evento, necesitamos dos cosas:
--
-- 1) UBICACIÓN CANÓNICA DEL USUARIO (users.home_lat/home_lng)
--    No queremos exactitud — un radio de kilómetros basta. Pero sí queremos
--    estabilidad: una única ubicación que refleje "dónde vive/trabaja el
--    usuario", no el punto exacto en el que abrió la app hoy.
--
--    Regla de actualización (ver server/lib/homeLocation.js y su test):
--      a) Sin home aún → el primer report se convierte en home.
--      b) Report cerca del home actual (≤ 500 m) → confirma, no cambia.
--      c) Report en un sitio NUEVO → se guarda como "pendiente".
--      d) Si el siguiente report cae cerca del pendiente (≤ 500 m) → el
--         pendiente se promociona a home. Es la regla "dos veces seguidas
--         en el mismo sitio nuevo".
--      e) Si en su lugar cae cerca del home → se descarta el pendiente
--         (falso positivo, el usuario estaba de paso).
--      f) Si cae en OTRO sitio nuevo → reemplaza el pendiente y vuelta a d.
--
--    Se cambia con POST /users/me/report-location, que el cliente llama
--    automáticamente cada vez que UserLocationContext obtiene coords.
--    No es un permission-prompt nuevo — se reutiliza el que ya existe.
--
-- 2) FILTRO EN COMMUNITY_EVENTS
--    (audience_center_lat, audience_center_lng, audience_radius_km) forman
--    un trio all-or-nothing: o los tres tienen valor y hay filtro por
--    círculo, o los tres son NULL y no lo hay. La constraint check lo
--    asegura. audience_radius_km está limitado por CHECK a 1..500 km.
--
-- Índice: (home_lat, home_lng) para el filtro bounding-box previo al
-- haversine — sin él, la consulta de audiencia haría full scan por cada
-- vez que el slider del cliente cambia el radio.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS home_lat            numeric(9, 6),
  ADD COLUMN IF NOT EXISTS home_lng            numeric(9, 6),
  ADD COLUMN IF NOT EXISTS home_updated_at     timestamptz,
  ADD COLUMN IF NOT EXISTS pending_home_lat    numeric(9, 6),
  ADD COLUMN IF NOT EXISTS pending_home_lng    numeric(9, 6),
  ADD COLUMN IF NOT EXISTS pending_home_seen_at timestamptz;

-- home_lat y home_lng deben estar ambos presentes o ambos ausentes.
-- (Anonymous/omitted CHECK name so ALTER … IF NOT EXISTS puede reintentarse
-- sin colisionar; si ya existe una constraint con este nombre, la migración
-- se recompone abajo.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_home_coords_both_or_none'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_home_coords_both_or_none
      CHECK ((home_lat IS NULL) = (home_lng IS NULL));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_pending_home_coords_both_or_none'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_pending_home_coords_both_or_none
      CHECK ((pending_home_lat IS NULL) = (pending_home_lng IS NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS users_home_coords_idx
  ON public.users (home_lat, home_lng)
  WHERE home_lat IS NOT NULL;

ALTER TABLE public.community_events
  ADD COLUMN IF NOT EXISTS audience_center_lat numeric(9, 6),
  ADD COLUMN IF NOT EXISTS audience_center_lng numeric(9, 6),
  ADD COLUMN IF NOT EXISTS audience_radius_km  numeric(5, 1);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'events_audience_location_all_or_none'
  ) THEN
    ALTER TABLE public.community_events
      ADD CONSTRAINT events_audience_location_all_or_none
      CHECK (
        (audience_center_lat IS NULL AND audience_center_lng IS NULL AND audience_radius_km IS NULL)
        OR
        (audience_center_lat IS NOT NULL AND audience_center_lng IS NOT NULL AND audience_radius_km IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'events_audience_radius_range'
  ) THEN
    ALTER TABLE public.community_events
      ADD CONSTRAINT events_audience_radius_range
      CHECK (audience_radius_km IS NULL OR (audience_radius_km >= 1 AND audience_radius_km <= 500));
  END IF;
END $$;
