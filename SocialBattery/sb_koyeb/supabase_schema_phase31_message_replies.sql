-- ============================================================
-- SocialBattery — Phase 31: Reply to Message (DMs)
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Add reply_to_id — points to the message being replied to.
--    ON DELETE SET NULL: if the original message row is ever hard-deleted,
--    the reply just becomes a normal message instead of breaking.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES public.messages(id) ON DELETE SET NULL;

-- 2. Index for the embedded PostgREST join (reply_to:reply_to_id(...))
CREATE INDEX IF NOT EXISTS idx_messages_reply_to
  ON public.messages(reply_to_id)
  WHERE reply_to_id IS NOT NULL;

-- No RLS changes needed — the existing "Message participants can read" policy
-- already covers the joined reply_to row, since a reply can only reference a
-- message from the same 1:1 conversation (validated server-side on insert).
