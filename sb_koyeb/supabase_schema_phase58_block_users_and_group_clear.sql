-- ============================================================
-- SocialBattery — Phase 58: Bloquear usuarios + Vaciar chat grupal
-- Run this in Supabase SQL Editor
-- ============================================================

-- ── 1. Bloqueo de usuarios (chats personales) ─────────────────────────────────
-- Si A bloquea a B: B no puede enviar mensajes a A, y A tampoco puede enviar
-- mensajes a B (se cierra la conversación en ambos sentidos, igual que en
-- WhatsApp/Instagram). Es asimétrico en almacenamiento (solo se guarda quién
-- bloqueó a quién) pero simétrico en efecto sobre el envío de mensajes.
CREATE TABLE IF NOT EXISTS public.blocked_users (
  blocker_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  blocked_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_id)
);

ALTER TABLE public.blocked_users ENABLE ROW LEVEL SECURITY;

-- Un usuario puede ver los bloqueos en los que participa (para saber si él
-- bloqueó a alguien, o si alguien le bloqueó a él).
DROP POLICY IF EXISTS "Users can see blocks involving them" ON public.blocked_users;
CREATE POLICY "Users can see blocks involving them"
  ON public.blocked_users
  FOR SELECT
  USING (auth.uid() = blocker_id OR auth.uid() = blocked_id);

-- Solo puede crear/eliminar bloqueos donde él es quien bloquea.
DROP POLICY IF EXISTS "Users manage own blocks" ON public.blocked_users;
CREATE POLICY "Users manage own blocks"
  ON public.blocked_users
  FOR ALL
  USING (auth.uid() = blocker_id)
  WITH CHECK (auth.uid() = blocker_id);

CREATE INDEX IF NOT EXISTS idx_blocked_users_blocker ON public.blocked_users(blocker_id);
CREATE INDEX IF NOT EXISTS idx_blocked_users_blocked ON public.blocked_users(blocked_id);

-- ── 2. Vaciar chat de grupo (solo afecta a la vista de quien lo vacía) ───────
-- Mismo patrón que conversation_clears (Phase 12) pero para friend_groups.
CREATE TABLE IF NOT EXISTS public.group_conversation_clears (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  group_id   UUID NOT NULL REFERENCES public.friend_groups(id) ON DELETE CASCADE,
  cleared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, group_id)
);

ALTER TABLE public.group_conversation_clears ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own group conversation clears" ON public.group_conversation_clears;
CREATE POLICY "Users manage own group conversation clears"
  ON public.group_conversation_clears
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_group_conv_clears_user_group
  ON public.group_conversation_clears(user_id, group_id);
