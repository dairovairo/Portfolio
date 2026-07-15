-- ============================================================
-- SocialBattery — Phase 59: Chat de quedada (pool chat)
-- Run this in Supabase SQL Editor
-- ============================================================
-- Añade un chat grupal dentro de cada quedada (hangout_pool), para que los
-- apuntados puedan hablar antes del plan. Mismo patrón que group_messages
-- (Phase 10) + group_conversation_clears (Phase 58), pero el "grupo" aquí
-- es la propia quedada: cualquier apuntado en pool_participants puede leer
-- y escribir.

-- ── 1. Mensajes de la quedada ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pool_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id    UUID NOT NULL REFERENCES public.hangout_pools(id) ON DELETE CASCADE,
  sender_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content    TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  type       TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'image')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pool_messages_pool ON public.pool_messages(pool_id, created_at);

ALTER TABLE public.pool_messages ENABLE ROW LEVEL SECURITY;

-- Solo los apuntados a la quedada pueden leer el chat.
DROP POLICY IF EXISTS "pool participants can read messages" ON public.pool_messages;
CREATE POLICY "pool participants can read messages"
  ON public.pool_messages
  FOR SELECT
  USING (
    pool_id IN (SELECT pool_id FROM public.pool_participants WHERE user_id = auth.uid())
  );

-- Solo los apuntados pueden escribir, y solo en su propio nombre.
DROP POLICY IF EXISTS "pool participants can send messages" ON public.pool_messages;
CREATE POLICY "pool participants can send messages"
  ON public.pool_messages
  FOR INSERT
  WITH CHECK (
    sender_id = auth.uid() AND
    pool_id IN (SELECT pool_id FROM public.pool_participants WHERE user_id = auth.uid())
  );

-- ── 2. Vaciar chat de quedada (solo afecta a la vista de quien lo vacía) ──────
CREATE TABLE IF NOT EXISTS public.pool_conversation_clears (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  pool_id    UUID NOT NULL REFERENCES public.hangout_pools(id) ON DELETE CASCADE,
  cleared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, pool_id)
);

ALTER TABLE public.pool_conversation_clears ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own pool conversation clears" ON public.pool_conversation_clears;
CREATE POLICY "Users manage own pool conversation clears"
  ON public.pool_conversation_clears
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_pool_conv_clears_user_pool
  ON public.pool_conversation_clears(user_id, pool_id);

-- ── 3. Realtime ────────────────────────────────────────────────────────────────
-- Sin esto, las suscripciones postgres_changes sobre pool_messages nunca
-- disparan (mismo fix que Phase 10/realtime_groups_fix para group_messages).
ALTER PUBLICATION supabase_realtime ADD TABLE public.pool_messages;
