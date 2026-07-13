-- ============================================================
-- SocialBattery — Phase 93: Silenciar grupos privados (ajuste global,
-- de verdad esta vez)
-- Run this in Supabase SQL Editor
-- ============================================================
-- Mismo bug que mute_pool_chats / mute_community_chats (fase 91): el
-- toggle "Silenciar grupos privados" de Ajustes > Notificaciones > Chats
-- vivía solo en localStorage y nunca se consultaba server-side, así que NO
-- silenciaba nada de verdad. El aviso real de un mensaje de grupo es un
-- web-push del servidor (broadcastGroupMessage en routes/groups.js) que
-- llega igual con la app en foreground o en segundo plano/cerrada, así que
-- el ajuste tiene que persistir en la fila del usuario para poder
-- filtrarse ahí también — no basta con localStorage.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS mute_group_chats boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
