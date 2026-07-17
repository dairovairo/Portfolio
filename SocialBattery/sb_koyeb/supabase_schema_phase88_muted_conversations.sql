-- ============================================================
-- SocialBattery — Phase 88: Silenciar chat con push en segundo plano
-- Run this in Supabase SQL Editor
-- ============================================================
-- Hasta ahora "Silenciar notificaciones" (grupo/quedada/comunidad) solo
-- se guardaba en localStorage y lo consultaba useMessageNotifications.js
-- para no disparar la notificación local — pero el web-push que recibe
-- el Service Worker con la app en segundo plano/cerrada se manda desde
-- el servidor (server/lib/webpush.js) sin tener ni idea de qué chats
-- tiene cada usuario silenciados. Esta tabla es la fuente de verdad que
-- el servidor consulta antes de enviar ese push.

CREATE TABLE IF NOT EXISTS public.muted_conversations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  conversation_type TEXT NOT NULL CHECK (conversation_type IN ('group', 'pool', 'community')),
  conversation_id   UUID NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, conversation_type, conversation_id)
);

-- Índice para el filtrado que hace notifyUsers antes de enviar el push:
-- "¿quién de esta lista de destinatarios tiene silenciado este chat?"
CREATE INDEX IF NOT EXISTS idx_muted_conv_lookup
  ON public.muted_conversations(conversation_type, conversation_id, user_id);

ALTER TABLE public.muted_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own muted conversations" ON public.muted_conversations;
CREATE POLICY "Users manage own muted conversations"
  ON public.muted_conversations
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

NOTIFY pgrst, 'reload schema';
