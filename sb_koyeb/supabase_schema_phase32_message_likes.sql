-- ============================================================
-- SocialBattery — Phase 32: Message Likes (❤️ reaction)
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Array of user IDs who liked this message (mirrors deleted_for_self pattern).
--    In a 1:1 chat this can only ever contain the sender and/or receiver, but an
--    array keeps it consistent with deleted_for_self and leaves room for group
--    chats later.
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS liked_by UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];

-- 2. No new RLS policy needed — "Sender can delete own messages" (phase 12)
--    already allows UPDATE by either sender_id or receiver_id, which is exactly
--    who's allowed to like/unlike a message in a 1:1 conversation.

-- 3. Index to speed up "did I like this" checks if ever queried directly
--    (not strictly required since likes are always read as part of the full
--    message row, but cheap to have).
CREATE INDEX IF NOT EXISTS idx_messages_liked_by ON public.messages USING GIN (liked_by);
