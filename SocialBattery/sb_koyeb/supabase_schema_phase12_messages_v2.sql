-- ============================================================
-- SocialBattery — Phase 12: Message Ticks, Delete & Clear Chat
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Add delivered_at to messages (tick: enviado → recibido → leido)
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

-- 2. Add delete-for-self (array of user IDs that deleted this message locally)
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS deleted_for_self UUID[] DEFAULT ARRAY[]::UUID[];

-- 3. Add delete-for-everyone (sender can delete for all, leaves trace)
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS deleted_for_everyone BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS deleted_for_everyone_at TIMESTAMPTZ;

-- 4. Table to track when a user cleared a conversation (only affects their view)
CREATE TABLE IF NOT EXISTS public.conversation_clears (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  partner_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  cleared_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, partner_id)
);

ALTER TABLE public.conversation_clears ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own conversation clears" ON public.conversation_clears;
CREATE POLICY "Users manage own conversation clears"
  ON public.conversation_clears
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 5. Allow UPDATE on messages for sender (delete for everyone)
DROP POLICY IF EXISTS "Sender can delete own messages" ON public.messages;
CREATE POLICY "Sender can delete own messages"
  ON public.messages
  FOR UPDATE
  USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

-- 6. Enable realtime on conversation_clears
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_clears;

-- 7. Index for faster clear lookups
CREATE INDEX IF NOT EXISTS idx_conv_clears_user_partner
  ON public.conversation_clears(user_id, partner_id);

-- 8. Index for delivered_at updates
CREATE INDEX IF NOT EXISTS idx_messages_delivered
  ON public.messages(receiver_id, delivered_at)
  WHERE delivered_at IS NULL;
