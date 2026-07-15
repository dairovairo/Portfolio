-- ============================================================
-- SocialBattery — Phase 97: Silenciar el hilo de UNA comunidad concreta
-- Run this in Supabase SQL Editor
-- ============================================================
-- Hasta ahora el aviso de "nueva publicación en el hilo" solo se podía
-- silenciar de dos formas: el silencio del CHAT de esa comunidad
-- (conversation_type 'community', fase 88 — comparte silencio con el hilo
-- sin querer) o el ajuste global "Silenciar hilos de comunidad" que aplica
-- a TODAS las comunidades a la vez (users.mute_community_threads, fase 96).
-- Faltaba un botón para silenciar el hilo de una comunidad en concreto sin
-- tocar su chat ni el resto de comunidades — mismo patrón que 'event'
-- (fase 89): nuevo conversation_type 'community_thread', mismo
-- conversation_id (el id de la comunidad).

ALTER TABLE public.muted_conversations
  DROP CONSTRAINT IF EXISTS muted_conversations_conversation_type_check;

ALTER TABLE public.muted_conversations
  ADD CONSTRAINT muted_conversations_conversation_type_check
    CHECK (conversation_type IN ('group', 'pool', 'community', 'event', 'community_thread'));

NOTIFY pgrst, 'reload schema';
