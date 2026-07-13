-- ============================================================
-- SocialBattery — Phase 85: Reply to Message (Community chat)
-- Run this in Supabase SQL Editor
-- ============================================================
-- Mismo patrón que Phase 31 (DMs) y Phase 84 (chat de quedada): añade
-- reply_to_id a community_messages para poder "responder destacando" un
-- mensaje del chat de comunidad, igual que ya se puede en los chats
-- personales y en el chat de la quedada.

-- 1. Add reply_to_id — points to the community message being replied to.
--    ON DELETE SET NULL: if the original message row is ever hard-deleted,
--    the reply just becomes a normal message instead of breaking.
ALTER TABLE public.community_messages
  ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES public.community_messages(id) ON DELETE SET NULL;

-- 2. Index for the embedded PostgREST join (reply_to:reply_to_id(...))
CREATE INDEX IF NOT EXISTS idx_community_messages_reply_to
  ON public.community_messages(reply_to_id)
  WHERE reply_to_id IS NOT NULL;

-- No RLS changes needed — la política existente que permite a los miembros
-- de la comunidad leer los mensajes ya cubre la fila embebida de reply_to,
-- ya que una respuesta solo puede referenciar un mensaje de la misma
-- comunidad (validado en el servidor al insertar).
