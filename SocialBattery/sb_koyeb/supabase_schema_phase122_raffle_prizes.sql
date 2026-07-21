-- ============================================================
-- SocialBattery — Phase 122: Premios de sorteo (múltiples ganadores)
--                            + revert de URL de sorteo (fase 121)
-- Run this in Supabase SQL Editor
-- ============================================================
-- Cambios de esta fase:
--
--   a) REVERT parcial de la fase 121: los sorteos NO deben tener URL
--      externa. Se descartó como concepto — un sorteo se identifica por
--      sus premios (título, foto, valor) y por su comunidad de origen,
--      no por un enlace que cuelgue el organizador. Se quitan las tres
--      cosas que la fase 121 añadió a community_raffles: la columna url,
--      la columna url_click_count y la RPC increment_raffle_url_clicks.
--      Los sorteos existentes que ya tuvieran valor en url pierden ese
--      dato — asumido, es información opcional que apenas llevaba dos
--      semanas en producción.
--
--   b) PREMIOS DE SORTEO: un sorteo puede tener N premios (1..M) en
--      lugar del ganador único que tenía hasta ahora. Cada premio lleva
--      título, foto opcional y valoración económica opcional (en
--      céntimos, para no arrastrar float). Al sortear se eligen N
--      ganadores distintos aleatorios y se asignan por orden de
--      posición: el primer ganador se lleva el premio position=1, el
--      segundo el position=2, etc. El organizador decide qué premio va
--      en cada posición al crearlo (posición 1 = suele ser el "gordo").
--
--      Retrocompatibilidad: community_raffles.winner_id NO se toca. Los
--      sorteos anteriores a esta fase (con winner_id no nulo y sin
--      filas en la tabla nueva) siguen viéndose como estaban — el
--      serializer devuelve el ganador legacy como el "principal" y no
--      tienen array de premios. Los sorteos nuevos usan solo la tabla
--      community_raffle_prizes; a partir de aquí winner_id queda como
--      "vestigio, no se rellena" en las creaciones nuevas.

-- ── 1. Revert de fase 121 sobre community_raffles ────────────────────────
ALTER TABLE public.community_raffles
  DROP COLUMN IF EXISTS url;
ALTER TABLE public.community_raffles
  DROP COLUMN IF EXISTS url_click_count;
DROP FUNCTION IF EXISTS public.increment_raffle_url_clicks(UUID);

-- ── 2. Tabla de premios ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.community_raffle_prizes (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  raffle_id  UUID        NOT NULL REFERENCES public.community_raffles(id) ON DELETE CASCADE,
  -- Posición 1-based dentro del sorteo. Determina el orden de sorteo
  -- (primer ganador extraído recibe position=1) y también el orden en
  -- que se pintan en la tarjeta / cuando se comunica al ganador. Se
  -- asigna en el server al insertar los premios, no lo elige el
  -- cliente — así el UNIQUE(raffle_id, position) no se puede colar por
  -- un cliente descuidado.
  position   INTEGER     NOT NULL CHECK (position >= 1),
  title      TEXT        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  image_url  TEXT,
  -- Valoración económica en céntimos (INTEGER). Opcional — un premio
  -- puede no tener precio de referencia (una experiencia, un cupón sin
  -- valor nominal). Coherente con la elección de céntimos que ya se hace
  -- en client/src/lib/adPricing.js para el resto de importes de la app.
  value_cents INTEGER    CHECK (value_cents IS NULL OR value_cents >= 0),
  -- Se rellena al ejecutar el sorteo. NULL antes del sorteo o cuando el
  -- sorteo se ejecutó pero había menos elegibles que premios (los premios
  -- sobrantes quedan sin adjudicar, ver POST /raffles/:id/draw).
  winner_id  UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Un raffle no puede tener dos premios en la misma posición. Se aplica
-- como constraint dura porque las asignaciones son en position=1..N sin
-- huecos, en un único insert por batch: si se duplica es un bug del
-- server, no un caso de negocio.
CREATE UNIQUE INDEX IF NOT EXISTS idx_raffle_prizes_raffle_position
  ON public.community_raffle_prizes(raffle_id, position);

-- Una misma persona no puede ganar dos premios del mismo sorteo (los
-- ganadores se eligen sin reemplazo). La constraint parcial protege
-- contra un fallo del server que intente reasignar en race. NULL de
-- winner_id se permite (premio pendiente de sortear o sobrante).
CREATE UNIQUE INDEX IF NOT EXISTS idx_raffle_prizes_unique_winner
  ON public.community_raffle_prizes(raffle_id, winner_id)
  WHERE winner_id IS NOT NULL;

-- Para las lecturas: pintar los premios de un sorteo ordenados es la
-- consulta más habitual.
CREATE INDEX IF NOT EXISTS idx_raffle_prizes_raffle
  ON public.community_raffle_prizes(raffle_id, position);

COMMENT ON TABLE  public.community_raffle_prizes IS 'Premios de un sorteo (fase 122). Sustituye al ganador único que tenía community_raffles.winner_id para todos los sorteos NUEVOS.';
COMMENT ON COLUMN public.community_raffle_prizes.position   IS 'Posición 1-based del premio dentro del sorteo. Al sortear, el i-ésimo ganador extraído se lleva el premio position=i.';
COMMENT ON COLUMN public.community_raffle_prizes.value_cents IS 'Valoración económica del premio en céntimos (opcional). Solo informativo — no se cobra ni retiene nada.';
COMMENT ON COLUMN public.community_raffle_prizes.winner_id  IS 'Ganador tras ejecutar el sorteo. NULL antes de sortear o si sobraron premios respecto al pool de elegibles.';

-- ── 3. RLS ───────────────────────────────────────────────────────────────
-- El backend (service role) bypassa RLS para todas las operaciones. La
-- política de lectura es una capa de defensa por si algún día se lee
-- esta tabla con el cliente del propio usuario — mismo criterio que
-- community_raffles: miembros de la comunidad ven los premios de sus
-- sorteos.
ALTER TABLE public.community_raffle_prizes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "community members can read raffle prizes" ON public.community_raffle_prizes;
CREATE POLICY "community members can read raffle prizes" ON public.community_raffle_prizes
  FOR SELECT USING (
    raffle_id IN (
      SELECT r.id
        FROM public.community_raffles r
        JOIN public.community_members m ON m.community_id = r.community_id
       WHERE m.user_id = auth.uid()
    )
  );

NOTIFY pgrst, 'reload schema';
