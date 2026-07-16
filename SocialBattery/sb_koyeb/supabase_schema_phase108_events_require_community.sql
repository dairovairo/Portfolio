-- Fase 108 — Los eventos ya no se pueden crear fuera de una comunidad.
--
-- Hasta ahora community_events.community_id era NULL-able (fase 14 lo
-- añadió como opcional para permitir "eventos sueltos" sin comunidad). A
-- partir de ahora todos los eventos tienen que pertenecer a una comunidad
-- concreta, tanto por la API (rechazamos POST /community/events sin
-- community_id) como por la BD (esta constraint).
--
-- IMPORTANTE — datos legacy: si en producción hay eventos históricos con
-- community_id NULL (creados con la API antigua), el ALTER de más abajo
-- FALLARÁ. Antes de aplicar esta migración, decide qué hacer con esos:
--
--   -- opción A: borrarlos
--   DELETE FROM public.community_events WHERE community_id IS NULL;
--
--   -- opción B: adoptarlos por una comunidad concreta
--   UPDATE public.community_events
--     SET community_id = '<uuid_de_una_comunidad_existente>'
--     WHERE community_id IS NULL;
--
-- Solo después ejecutar este ALTER.
--
-- NOTA: eventPromoPacing.js y otras rutas mantienen los guards
-- `event.community_id ?` como red de seguridad — no molestan y protegen
-- ante filas legacy que aún estén en BD durante el rollout.

-- Pre-check: si hay eventos con community_id NULL, aborta con un mensaje
-- claro para que el operador vea CUÁNTOS y decida (borrar / adoptar) antes
-- de ejecutar el ALTER. Si son 0, la migración sigue tranquila.
DO $$
DECLARE
  legacy_count integer;
BEGIN
  SELECT COUNT(*) INTO legacy_count
    FROM public.community_events
    WHERE community_id IS NULL;

  IF legacy_count > 0 THEN
    RAISE EXCEPTION
      'Fase 108 abortada: hay % eventos con community_id NULL. Decide qué hacer con ellos (borrarlos o adoptarlos por una comunidad) antes de ejecutar esta migración. Ver comentario en la cabecera de este archivo.',
      legacy_count;
  END IF;
END $$;

ALTER TABLE public.community_events
  ALTER COLUMN community_id SET NOT NULL;
