-- ============================================================
-- SocialBattery — Phase 112: Ciclo de vida de la publicidad de sorteos
-- Run this in Supabase SQL Editor
-- ============================================================
-- En eventos ya existía desde antes (ver POST /events/:id/renew-promotion
-- y POST /events/:id/end-promotion) la posibilidad de:
--
--   · FINALIZAR la promoción antes de tiempo → pasa a plan basic, deja de
--     enviarse publicidad, se congela el contador antes de que arranque
--     el evento.
--   · RENOVAR la promoción → resetea el contador y el historial de a
--     quién se ha notificado, y arranca un nuevo ciclo con plan y cuota
--     posiblemente distintos.
--
-- Ambas acciones exigen que el evento haya alcanzado antes el umbral de
-- cobro (FREE_THRESHOLD = 200 envíos), para que no se puedan encadenar
-- ciclos "gratis" contratando y cancelando/renovando al instante.
--
-- Los SORTEOS no tenían ni una cosa ni la otra. Con el dashboard de
-- publicidad (fase 111) es incoherente que el creador vea qué está
-- funcionando y no pueda actuar sobre ello, así que se replica el modelo:
-- finalizar corta el reparto, renovar resetea targets y arranca un ciclo
-- nuevo con posiblemente otro aforo y otro filtro.
--
-- Se aplica solo a Light y Community: Volt es gratis (price_cents=0), no
-- hay nada que "cobrar" ni sentido en renovarlo — su reparto acaba
-- cuando el sorteo termina y punto.
--
-- Esta migración toca solo el estado en BD (columna nueva). La lógica
-- del "no se sirven banners con la promo cerrada" vive en el endpoint
-- GET /api/community/raffle-banner (ver community.js).

-- ── promo_ended_at ─────────────────────────────────────────────────────────
-- Marca el momento en que el creador cerró el reparto de banners de este
-- sorteo antes de tiempo. NULL = promoción activa (comportamiento
-- histórico y por defecto — los sorteos sin esta columna se ven como
-- "activos"). El sorteo en sí sigue vivo hasta su ends_at / drawn_at; lo
-- único que cambia es que:
--
--   · Los raffle_banner_targets pendientes (shown_at IS NULL) dejan de
--     servirse: el endpoint GET /raffle-banner los filtra fuera. NO se
--     borran — se mantienen para que las métricas históricas del
--     dashboard sigan cuadrando.
--   · Un nuevo POST /raffles/:raffleId/renew-promotion vuelve a poner
--     esta columna a NULL, borra los targets del ciclo anterior y
--     reasigna un ciclo nuevo (mismo patrón que renew-promotion de
--     eventos: cada renovación es un ciclo limpio para las métricas).
ALTER TABLE public.community_raffles
  ADD COLUMN IF NOT EXISTS promo_ended_at TIMESTAMPTZ;

COMMENT ON COLUMN public.community_raffles.promo_ended_at IS
  'Momento en que el creador cerró el reparto de banners de este sorteo antes de tiempo (POST /raffles/:raffleId/end-promotion). NULL = promoción activa. El sorteo sigue vivo hasta ends_at/drawn_at; solo se corta el reparto de nuevos banners. Al renovar (POST /raffles/:raffleId/renew-promotion) se vuelve a NULL.';

-- Índice parcial: la lista de sorteos activos con promo abierta se usa a
-- cada llamada de GET /raffle-banner (una por cada entrada al menú
-- principal de cada usuario). El índice cubre justo esa consulta: filas
-- con promo_ended_at NULL, agrupables por id. En sorteos con la promo ya
-- cerrada — que son la mayoría a largo plazo — el índice ni siquiera los
-- guarda, así que se mantiene pequeño.
CREATE INDEX IF NOT EXISTS idx_community_raffles_promo_active
  ON public.community_raffles (id)
  WHERE promo_ended_at IS NULL;

NOTIFY pgrst, 'reload schema';
