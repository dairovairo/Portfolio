-- ============================================================
-- SocialBattery — Phase 91: Silenciar chat de quedadas / chat de comunidad
-- (ajuste global, Ajustes > Notificaciones)
-- Run this in Supabase SQL Editor
-- ============================================================
-- Igual que mute_new_pools (fase 90): el chat de quedadas y el chat de
-- comunidad mandan un web-push real (broadcastPoolChatMessage en
-- routes/pools.js y broadcastCommunityMessage en routes/community.js) que
-- llega igual con la app en foreground o en segundo plano/cerrada, así que
-- el ajuste no puede vivir solo en localStorage — necesita persistir en la
-- fila del usuario para poder filtrarse server-side.
--
-- Estos dos toggles son GLOBALES (silencian todos los chats de quedada / de
-- comunidad a la vez) y son independientes del silencio por conversación
-- individual (muted_conversations, fase 88), que sigue funcionando igual
-- para silenciar un chat concreto.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS mute_pool_chats      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mute_community_chats boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
