-- ============================================================
-- SocialBattery — Phase 77: Mensaje fijado en chats personales
-- Run this in Supabase SQL Editor
-- ============================================================
-- Los chats 1:1 no tienen una fila "de chat" propia como los grupos
-- (friend_groups) o las quedadas (hangout_pools), así que el mensaje
-- fijado se guarda en una tabla aparte, indexada por la amistad
-- (friendships.id) que identifica de forma única cada conversación.
--
-- Un único mensaje fijado por conversación, igual que en grupos/quedadas.

CREATE TABLE IF NOT EXISTS public.conversation_pins (
  friendship_id      UUID PRIMARY KEY REFERENCES public.friendships(id) ON DELETE CASCADE,
  pinned_message_id  UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  pinned_by          UUID REFERENCES public.users(id) ON DELETE SET NULL,
  pinned_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_pins;

-- Nota de permisos (Phase 77.1): a partir de ahora, en grupos y quedadas
-- cualquier miembro puede fijar/desfijar mensajes, no solo el
-- administrador/creador — ver server/routes/groups.js y server/routes/pools.js.
-- No requiere cambios de esquema, solo de lógica del servidor.
