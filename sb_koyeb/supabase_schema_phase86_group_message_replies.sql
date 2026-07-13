-- ============================================================
-- SocialBattery — Phase 86: Reply to Message (Group chat)
-- Run this in Supabase SQL Editor
-- ============================================================
-- Mismo patrón que Phase 84 (Reply to Message en chat de quedadas) y
-- Phase 31 (Reply to Message en DMs): añade reply_to_id a group_messages
-- para poder "responder destacando" un mensaje del chat grupal, igual que
-- ya se puede en los chats personales.

-- 1. Add reply_to_id — points to the group message being replied to.
--    ON DELETE SET NULL: if the original message row is ever hard-deleted,
--    the reply just becomes a normal message instead of breaking.
ALTER TABLE public.group_messages
  ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES public.group_messages(id) ON DELETE SET NULL;

-- 2. Index for the embedded PostgREST join (reply_to:reply_to_id(...))
CREATE INDEX IF NOT EXISTS idx_group_messages_reply_to
  ON public.group_messages(reply_to_id)
  WHERE reply_to_id IS NOT NULL;

-- No RLS changes needed — la política existente que permite a los miembros
-- del grupo leer sus mensajes ya cubre la fila embebida de reply_to, ya que
-- una respuesta solo puede referenciar un mensaje del mismo grupo (validado
-- en el servidor al insertar).
