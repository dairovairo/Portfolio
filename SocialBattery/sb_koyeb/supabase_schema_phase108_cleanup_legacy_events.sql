-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ COMPANION de la migración phase108_events_require_community.sql     │
-- │                                                                      │
-- │ Ejecutar ANTES de correr phase108 si el pre-check aborta con         │
-- │ "hay N eventos con community_id NULL". Elige UNO de los tres        │
-- │ escenarios (descomenta el bloque que quieras) y luego reintenta      │
-- │ phase108, que ya pasará el pre-check y aplicará el NOT NULL.        │
-- └──────────────────────────────────────────────────────────────────────┘

-- 1) DIAGNÓSTICO — para saber qué son esos 20 eventos antes de decidir.
--    Descomenta y ejecuta esto solo (no modifica nada).
--
-- SELECT id, title, creator_id, event_date, promotion_plan,
--        created_at, notification_count, notification_sent_count
--   FROM public.community_events
--  WHERE community_id IS NULL
--  ORDER BY created_at DESC;


-- 2) BORRARLOS (opción A) — la opción por defecto si son datos de prueba
--    o eventos sueltos que ya no tienen sentido. Se limpian también las
--    filas dependientes por integridad (event_promo_notifications,
--    community_event_attendees) antes de borrar el evento.
--
-- DELETE FROM public.event_promo_notifications
--  WHERE event_id IN (SELECT id FROM public.community_events WHERE community_id IS NULL);
-- DELETE FROM public.community_event_attendees
--  WHERE event_id IN (SELECT id FROM public.community_events WHERE community_id IS NULL);
-- DELETE FROM public.community_events
--  WHERE community_id IS NULL;


-- 3) ADOPTARLOS (opción B) — asignar todos los eventos huérfanos a una
--    comunidad concreta. Sustituye 'PON-AQUI-EL-UUID' por el UUID real
--    de la comunidad receptora. La constraint verificará al aplicar el
--    NOT NULL, así que asegúrate de que todos los eventos afectados
--    tienen sentido en esa comunidad.
--
-- UPDATE public.community_events
--    SET community_id = 'PON-AQUI-EL-UUID'::uuid
--  WHERE community_id IS NULL;


-- 4) ADOPTAR CADA UNO POR EL CREADOR — si tus creadores suelen tener
--    una única comunidad admin, esto los mete en LA comunidad que
--    creó cada creator. Filas cuyo creador no tenga comunidad admin
--    quedan aún NULL y siguen bloqueando phase108, así que ejecuta el
--    diagnóstico (1) después para ver si queda alguna.
--
-- UPDATE public.community_events e
--    SET community_id = c.id
--   FROM public.communities c
--  WHERE c.creator_id = e.creator_id
--    AND e.community_id IS NULL;
