-- ============================================================
-- SocialBattery — Phase 75: Chat de comunidad
-- Run this in Supabase SQL Editor
-- ============================================================
-- Mismo patrón que group_messages (Phase 10) + poll_options
-- (Phase 74) + group_conversation_clears (Phase 58), pero
-- aplicado a communities/community_members en vez de
-- friend_groups/friend_group_members.
--
-- Además, añade el rol 'moderator' a community_members: el fondo
-- del chat de comunidad solo lo puede cambiar un admin o un
-- moderador (a diferencia de los grupos, donde cualquier miembro
-- puede poner su propio fondo local).

-- ── 1. Rol de moderador en community_members ─────────────────
ALTER TABLE public.community_members
  DROP CONSTRAINT IF EXISTS community_members_role_check;
ALTER TABLE public.community_members
  ADD CONSTRAINT community_members_role_check
  CHECK (role IN ('admin', 'moderator', 'member'));

-- ── 2. Mensajes de la comunidad ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.community_messages (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID        NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  sender_id    UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content      TEXT        NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  type         TEXT        NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'image', 'poll')),
  poll_options JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_community_messages_community
  ON public.community_messages(community_id, created_at);

-- ── 3. Votos de encuestas del chat de comunidad ───────────────
CREATE TABLE IF NOT EXISTS public.community_message_poll_votes (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id   UUID        NOT NULL REFERENCES public.community_messages(id) ON DELETE CASCADE,
  community_id UUID        NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  option_index INTEGER     NOT NULL CHECK (option_index >= 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_community_poll_votes_message ON public.community_message_poll_votes(message_id);
CREATE INDEX IF NOT EXISTS idx_community_poll_votes_community ON public.community_message_poll_votes(community_id);

-- ── 4. Vaciar chat (solo afecta a la vista de quien lo vacía) ─
CREATE TABLE IF NOT EXISTS public.community_conversation_clears (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  community_id UUID        NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  cleared_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, community_id)
);

CREATE INDEX IF NOT EXISTS idx_community_conv_clears_user_community
  ON public.community_conversation_clears(user_id, community_id);

-- ── 5. RLS ─────────────────────────────────────────────────────
ALTER TABLE public.community_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_message_poll_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_conversation_clears ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "community members can read messages" ON public.community_messages;
CREATE POLICY "community members can read messages" ON public.community_messages
  FOR SELECT USING (
    community_id IN (SELECT community_id FROM public.community_members WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "community members can send messages" ON public.community_messages;
CREATE POLICY "community members can send messages" ON public.community_messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid() AND
    community_id IN (SELECT community_id FROM public.community_members WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "community members can read poll votes" ON public.community_message_poll_votes;
CREATE POLICY "community members can read poll votes" ON public.community_message_poll_votes
  FOR SELECT USING (
    community_id IN (SELECT community_id FROM public.community_members WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "community members can cast their vote" ON public.community_message_poll_votes;
CREATE POLICY "community members can cast their vote" ON public.community_message_poll_votes
  FOR INSERT WITH CHECK (
    user_id = auth.uid() AND
    community_id IN (SELECT community_id FROM public.community_members WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "community members can change their vote" ON public.community_message_poll_votes;
CREATE POLICY "community members can change their vote" ON public.community_message_poll_votes
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "community members can remove their vote" ON public.community_message_poll_votes;
CREATE POLICY "community members can remove their vote" ON public.community_message_poll_votes
  FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own community conversation clears" ON public.community_conversation_clears;
CREATE POLICY "Users manage own community conversation clears"
  ON public.community_conversation_clears
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── 6. Realtime ────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.community_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.community_message_poll_votes;
ALTER TABLE public.community_message_poll_votes REPLICA IDENTITY FULL;
