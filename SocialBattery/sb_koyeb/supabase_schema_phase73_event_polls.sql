-- Phase 73: Encuestas en tiempo real dentro de "Actualizaciones del evento"
--
-- Las encuestas se guardan como una fila más de event_updates (mismo hilo,
-- mismo orden cronológico, mismo endpoint de borrado) en vez de crear una
-- tabla paralela: así aparecen intercaladas junto al resto de actualizaciones
-- sin duplicar lógica de listado/paginación/borrado.
--
-- event_updates.poll_question / poll_options identifican una fila como
-- encuesta (poll_question NOT NULL). Los votos van en una tabla aparte,
-- event_poll_votes, con un voto por usuario por encuesta (se puede cambiar
-- de opción, lo que hace UPDATE sobre la fila existente).
--
-- event_id se desnormaliza en event_poll_votes para poder filtrar el canal
-- realtime directamente por evento (Supabase Realtime solo soporta filtros
-- de igualdad simples, no "IN (subquery)").

ALTER TABLE public.event_updates
  ADD COLUMN IF NOT EXISTS poll_question TEXT,
  ADD COLUMN IF NOT EXISTS poll_options  JSONB;

ALTER TABLE public.event_updates
  DROP CONSTRAINT IF EXISTS event_updates_has_content_or_image;

ALTER TABLE public.event_updates
  ADD CONSTRAINT event_updates_has_content_or_image
  CHECK (content IS NOT NULL OR image_url IS NOT NULL OR poll_question IS NOT NULL);

ALTER TABLE public.event_updates
  DROP CONSTRAINT IF EXISTS event_updates_poll_needs_options;

ALTER TABLE public.event_updates
  ADD CONSTRAINT event_updates_poll_needs_options
  CHECK (poll_question IS NULL OR jsonb_array_length(poll_options) >= 2);

-- ── Votos de encuesta ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.event_poll_votes (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  update_id     UUID        NOT NULL REFERENCES public.event_updates(id) ON DELETE CASCADE,
  event_id      UUID        NOT NULL REFERENCES public.community_events(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  option_index  INTEGER     NOT NULL CHECK (option_index >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (update_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_poll_votes_update
  ON public.event_poll_votes(update_id);

CREATE INDEX IF NOT EXISTS idx_event_poll_votes_event
  ON public.event_poll_votes(event_id);

-- ── Row Level Security ─────────────────────────────
ALTER TABLE public.event_poll_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Poll votes are public" ON public.event_poll_votes;
CREATE POLICY "Poll votes are public" ON public.event_poll_votes
  FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "Users can cast their own vote" ON public.event_poll_votes;
CREATE POLICY "Users can cast their own vote" ON public.event_poll_votes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can change their own vote" ON public.event_poll_votes;
CREATE POLICY "Users can change their own vote" ON public.event_poll_votes
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can remove their own vote" ON public.event_poll_votes;
CREATE POLICY "Users can remove their own vote" ON public.event_poll_votes
  FOR DELETE USING (auth.uid() = user_id);

-- ── Realtime ───────────────────────────────────────
-- event_updates ya está en la publicación (fase 20) — eso ya permite recibir
-- en vivo las nuevas encuestas/actualizaciones publicadas por el organizador.
-- Añadimos también los votos para que los recuentos se actualicen en vivo.
ALTER PUBLICATION supabase_realtime ADD TABLE public.event_poll_votes;

-- El filtro realtime del cliente usa event_id=eq.<id> para escuchar solo los
-- votos del evento abierto. Para eventos UPDATE/DELETE, Postgres solo incluye
-- en el "old record" las columnas de la clave primaria salvo que la tabla use
-- REPLICA IDENTITY FULL — sin esto, cambiar o quitar un voto no llegaría a
-- otros usuarios en tiempo real porque el filtro no encontraría event_id.
ALTER TABLE public.event_poll_votes REPLICA IDENTITY FULL;
