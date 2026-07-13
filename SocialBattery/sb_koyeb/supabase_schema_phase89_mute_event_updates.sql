-- ============================================================
-- SocialBattery — Phase 89: Silenciar actualizaciones de un evento
-- Run this in Supabase SQL Editor
-- ============================================================
-- Reutiliza la tabla muted_conversations de la fase 88 (silenciar chats de
-- grupo/quedada/comunidad) para el nuevo caso: un asistente (no organizador)
-- silencia los avisos/actualizaciones de un evento concreto desde
-- EventDetailPage.jsx. conversation_id pasa a ser el id del evento y
-- conversation_type = 'event'.

ALTER TABLE public.muted_conversations
  DROP CONSTRAINT IF EXISTS muted_conversations_conversation_type_check;

ALTER TABLE public.muted_conversations
  ADD CONSTRAINT muted_conversations_conversation_type_check
    CHECK (conversation_type IN ('group', 'pool', 'community', 'event'));

NOTIFY pgrst, 'reload schema';
