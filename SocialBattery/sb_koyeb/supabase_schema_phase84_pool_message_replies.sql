-- ============================================================
-- SocialBattery — Phase 84: Reply to Message (Pool / Quedada chat)
-- Run this in Supabase SQL Editor
-- ============================================================
-- Mismo patrón que Phase 31 (Reply to Message en DMs): añade reply_to_id a
-- pool_messages para poder "responder destacando" un mensaje del chat de la
-- quedada, igual que ya se puede en los chats personales.

-- 1. Add reply_to_id — points to the pool message being replied to.
--    ON DELETE SET NULL: if the original message row is ever hard-deleted,
--    the reply just becomes a normal message instead of breaking.
ALTER TABLE public.pool_messages
  ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES public.pool_messages(id) ON DELETE SET NULL;

-- 2. Index for the embedded PostgREST join (reply_to:reply_to_id(...))
CREATE INDEX IF NOT EXISTS idx_pool_messages_reply_to
  ON public.pool_messages(reply_to_id)
  WHERE reply_to_id IS NOT NULL;

-- No RLS changes needed — la política existente "pool participants can read
-- messages" ya cubre la fila embebida de reply_to, ya que una respuesta solo
-- puede referenciar un mensaje de la misma quedada (validado en el servidor
-- al insertar).
