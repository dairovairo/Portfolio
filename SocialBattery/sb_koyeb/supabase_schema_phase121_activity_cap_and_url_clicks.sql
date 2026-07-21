-- ============================================================
-- SocialBattery — Phase 121: Cap de actividades activas por comunidad
--                            + tracking de clicks a URL externa
-- Run this in Supabase SQL Editor
-- ============================================================
-- Cambios de negocio de esta fase:
--
--   a) TOPE DE ACTIVIDADES: como mucho 4 actividades "vivas" a la vez por
--      comunidad, contando eventos + sorteos juntos. Una actividad está
--      viva si NO está acabada. Definición idéntica a la que ya usa el
--      dashboard (ver server/routes/community.js → dashboard `ended`):
--        · Evento: NO acabado si COALESCE(ends_at, event_date) > NOW().
--        · Sorteo: NO acabado si drawn_at IS NULL AND ends_at > NOW().
--      El límite se aplica en el server al crear (POST /events y
--      POST /communities/:id/raffles). No hay constraint SQL porque el
--      count activo se calcula sobre filas de dos tablas distintas y
--      cambia con el tiempo (una CHECK no puede leer NOW()). La función
--      de conteo se define abajo para poder reutilizarla desde JS.
--
--   b) URL CLICK COUNTS: se cuentan los clicks del usuario a la URL
--      externa que cuelga el organizador en:
--        · community_events.url (fase 19) — enlace del evento.
--        · community_raffles.url (NUEVO en esta fase) — enlace del sorteo.
--        · communities.url (fase 19) — enlace de la comunidad, acumulado
--          a lo largo de toda la vida de la comunidad. A propósito NO se
--          desglosa por evento/sorteo de origen (ese desglose se puede
--          reconstruir mirando la URL específica de cada actividad).
--
--      Es un contador ingenuo (cada click cuenta, aunque sea el mismo
--      usuario abriendo la web tres veces), NO uno de personas únicas
--      como los clicks internos de anuncio (event_promo_notifications.
--      clicked_at, raffle_banner_targets.clicked_at). El motivo: aquí
--      no se está midiendo el CTR de una campaña — se está midiendo la
--      tracción bruta del enlace del organizador. Si se necesita CTR
--      real más adelante habrá que promocionar esto a tabla completa.

-- ── 1. URL de sorteo (opcional) ──────────────────────────────────────────
-- Los sorteos hoy no tenían campo url; se les añade aquí para que el
-- organizador pueda colgar un enlace (base del negocio, redes,
-- landing…) y así medir clicks igual que en eventos.
ALTER TABLE public.community_raffles
  ADD COLUMN IF NOT EXISTS url TEXT;

COMMENT ON COLUMN public.community_raffles.url IS
  'URL externa opcional que cuelga el organizador del sorteo. Los clicks a este enlace se agregan en url_click_count.';

-- ── 2. Contadores de clicks a URL externa ─────────────────────────────────
-- Se guardan como columna simple en cada tabla — es un contador
-- puro, sin necesidad de auditoría (quién lo tocó y cuándo). Los
-- endpoints que incrementan usan la RPC atómica de más abajo.

ALTER TABLE public.communities
  ADD COLUMN IF NOT EXISTS url_click_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.community_events
  ADD COLUMN IF NOT EXISTS url_click_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.community_raffles
  ADD COLUMN IF NOT EXISTS url_click_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.communities.url_click_count IS
  'Clicks totales a communities.url a lo largo de la vida de la comunidad. Contador acumulado ingenuo (cada tap cuenta), no personas únicas.';
COMMENT ON COLUMN public.community_events.url_click_count IS
  'Clicks totales al enlace externo del evento (community_events.url). Se muestra en el dashboard de publicidad junto al CTR de las notificaciones.';
COMMENT ON COLUMN public.community_raffles.url_click_count IS
  'Clicks totales al enlace externo del sorteo (community_raffles.url). Se muestra en el dashboard de publicidad junto al CTR de los banners.';

-- ── 3. Incrementos atómicos ───────────────────────────────────────────────
-- Postgres-native +1 sin race conditions. Se llaman desde los endpoints
-- POST /events/:id/url-click, /raffles/:id/url-click y /communities/:id/
-- url-click con SECURITY DEFINER + EXECUTE limitado a service_role: la
-- comprobación de "eres un usuario autenticado" vive en el server (auth
-- middleware), y desde el cliente vía PostgREST no se puede llamar.
--
-- El VOID de retorno + STRICT hacen que un id inexistente sea NO-OP en
-- vez de excepción: si el usuario borra el evento entre que le da al
-- link y llega el ping, no queremos que devuelva 500 y ensucie logs.
CREATE OR REPLACE FUNCTION public.increment_community_url_clicks(p_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.communities
    SET url_click_count = url_click_count + 1
    WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION public.increment_event_url_clicks(p_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.community_events
    SET url_click_count = url_click_count + 1
    WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION public.increment_raffle_url_clicks(p_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.community_raffles
    SET url_click_count = url_click_count + 1
    WHERE id = p_id;
$$;

REVOKE ALL ON FUNCTION public.increment_community_url_clicks(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_event_url_clicks(UUID)     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_raffle_url_clicks(UUID)    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_community_url_clicks(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_event_url_clicks(UUID)     TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_raffle_url_clicks(UUID)    TO service_role;

-- ── 4. Conteo de actividades activas por comunidad ───────────────────────
-- Una consulta SQL que suma eventos + sorteos vivos en una comunidad.
-- Se usa desde el server justo antes de INSERT en POST /events y
-- POST /communities/:id/raffles para rechazar cuando ya se llegó al
-- tope (ACTIVE_ACTIVITY_LIMIT_PER_COMMUNITY = 4 en JS). También la usa
-- el dashboard para pintar el "X/4 actividades activas".
--
-- "Activo" = mismo criterio que "ended" del dashboard:
--   · Evento: COALESCE(ends_at, event_date) > NOW().
--   · Sorteo: drawn_at IS NULL AND ends_at > NOW().
--
-- La función no acepta id de excepción (para "cuenta pero no me
-- cuentes a mí"): el chequeo es SIEMPRE antes de INSERT, en creación
-- pura, así que la fila que estamos por crear todavía no existe y no
-- entra en el count. En renovaciones o edits no se usa este límite.
CREATE OR REPLACE FUNCTION public.community_active_activity_count(p_community_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(*)::INTEGER FROM public.community_events
       WHERE community_id = p_community_id
         AND COALESCE(ends_at, event_date) > NOW())
    +
    (SELECT COUNT(*)::INTEGER FROM public.community_raffles
       WHERE community_id = p_community_id
         AND drawn_at IS NULL
         AND ends_at > NOW());
$$;

REVOKE ALL ON FUNCTION public.community_active_activity_count(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_active_activity_count(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
