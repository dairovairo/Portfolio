-- ============================================================
-- SocialBattery — Phase 96: Silenciar hilos de comunidad (ajuste global)
-- Run this in Supabase SQL Editor
-- ============================================================
-- Mismo patrón que mute_community_chats (fase 91): el aviso de "nueva
-- publicación en el hilo" (POST /community/communities/:id/posts →
-- broadcastCommunityPostToMembers) manda un broadcast in-app instantáneo +
-- web-push real, y hasta ahora solo se filtraba por el silencio de esa
-- comunidad en concreto (muted_conversations, fase 88), sin un ajuste
-- global. mute_community_threads permite silenciar los hilos de TODAS las
-- comunidades del usuario de una vez, aplicando igual con la app abierta
-- (foreground, CommunityNotificationsContext) que en segundo plano/cerrada
-- (web-push, server/routes/community.js).

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS mute_community_threads boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
