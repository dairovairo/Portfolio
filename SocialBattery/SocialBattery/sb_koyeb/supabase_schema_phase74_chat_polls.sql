-- ============================================================
-- SocialBattery — Phase 74: Encuestas en el chat de quedadas y grupos
-- Run this in Supabase SQL Editor
-- ============================================================
-- Añade encuestas dentro del propio chat de cada quedada (pool_messages) y
-- del chat de cada grupo (group_messages), como un tipo de mensaje más
-- ('poll') en vez de una tabla paralela — mismo criterio que ya se usa para
-- las imágenes (type='image'). La pregunta se guarda en `content` (ya es
-- NOT NULL en ambas tablas) y las opciones en la nueva columna
-- `poll_options` (JSONB).
--
-- A diferencia de las encuestas de eventos de comunidad (Phase 73), donde
-- solo el organizador puede publicarlas, aquí CUALQUIER apuntado a la
-- quedada / miembro del grupo puede crear una encuesta y votar.
--
-- Los votos van en tablas aparte (pool_message_poll_votes /
-- group_message_poll_votes), un voto por usuario por encuesta (se puede
-- cambiar de opción, lo que hace UPSERT sobre la fila existente). pool_id /
-- group_id se desnormalizan en la tabla de votos para poder filtrar el
-- canal realtime directamente por quedada/grupo (Supabase Realtime solo
-- soporta filtros de igualdad simples, no "IN (subquery)").

-- ── 1. Chat de quedada (pool_messages) ──────────────────────────────────────

ALTER TABLE public.pool_messages
  ADD COLUMN IF NOT EXISTS poll_options JSONB;

ALTER TABLE public.pool_messages DROP CONSTRAINT IF EXISTS pool_messages_type_check;
ALTER TABLE public.pool_messages ADD CONSTRAINT pool_messages_type_check
  CHECK (type IN ('text', 'image', 'poll'));

CREATE TABLE IF NOT EXISTS public.pool_message_poll_votes (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id   UUID        NOT NULL REFERENCES public.pool_messages(id) ON DELETE CASCADE,
  pool_id      UUID        NOT NULL REFERENCES public.hangout_pools(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  option_index INTEGER     NOT NULL CHECK (option_index >= 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_pool_poll_votes_message ON public.pool_message_poll_votes(message_id);
CREATE INDEX IF NOT EXISTS idx_pool_poll_votes_pool    ON public.pool_message_poll_votes(pool_id);

ALTER TABLE public.pool_message_poll_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pool participants can read poll votes" ON public.pool_message_poll_votes;
CREATE POLICY "pool participants can read poll votes"
  ON public.pool_message_poll_votes
  FOR SELECT
  USING (
    pool_id IN (SELECT pool_id FROM public.pool_participants WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "pool participants can cast their vote" ON public.pool_message_poll_votes;
CREATE POLICY "pool participants can cast their vote"
  ON public.pool_message_poll_votes
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid() AND
    pool_id IN (SELECT pool_id FROM public.pool_participants WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "pool participants can change their vote" ON public.pool_message_poll_votes;
CREATE POLICY "pool participants can change their vote"
  ON public.pool_message_poll_votes
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "pool participants can remove their vote" ON public.pool_message_poll_votes;
CREATE POLICY "pool participants can remove their vote"
  ON public.pool_message_poll_votes
  FOR DELETE USING (auth.uid() = user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.pool_message_poll_votes;
ALTER TABLE public.pool_message_poll_votes REPLICA IDENTITY FULL;

-- ── 2. Chat de grupo (group_messages) ───────────────────────────────────────

ALTER TABLE public.group_messages
  ADD COLUMN IF NOT EXISTS poll_options JSONB;

ALTER TABLE public.group_messages DROP CONSTRAINT IF EXISTS group_messages_type_check;
ALTER TABLE public.group_messages ADD CONSTRAINT group_messages_type_check
  CHECK (type IN ('text', 'hangout_request', 'image', 'poll'));

CREATE TABLE IF NOT EXISTS public.group_message_poll_votes (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id   UUID        NOT NULL REFERENCES public.group_messages(id) ON DELETE CASCADE,
  group_id     UUID        NOT NULL REFERENCES public.friend_groups(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  option_index INTEGER     NOT NULL CHECK (option_index >= 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_poll_votes_message ON public.group_message_poll_votes(message_id);
CREATE INDEX IF NOT EXISTS idx_group_poll_votes_group   ON public.group_message_poll_votes(group_id);

ALTER TABLE public.group_message_poll_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "group members can read poll votes" ON public.group_message_poll_votes;
CREATE POLICY "group members can read poll votes"
  ON public.group_message_poll_votes
  FOR SELECT
  USING (
    group_id IN (SELECT group_id FROM public.friend_group_members WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "group members can cast their vote" ON public.group_message_poll_votes;
CREATE POLICY "group members can cast their vote"
  ON public.group_message_poll_votes
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid() AND
    group_id IN (SELECT group_id FROM public.friend_group_members WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "group members can change their vote" ON public.group_message_poll_votes;
CREATE POLICY "group members can change their vote"
  ON public.group_message_poll_votes
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "group members can remove their vote" ON public.group_message_poll_votes;
CREATE POLICY "group members can remove their vote"
  ON public.group_message_poll_votes
  FOR DELETE USING (auth.uid() = user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.group_message_poll_votes;
ALTER TABLE public.group_message_poll_votes REPLICA IDENTITY FULL;
