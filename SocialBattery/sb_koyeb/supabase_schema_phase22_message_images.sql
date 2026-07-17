-- ============================================================
-- SocialBattery — Phase 22: Image Messages in Chat
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Add 'image' value to message_type ENUM (individual DMs)
ALTER TYPE message_type ADD VALUE IF NOT EXISTS 'image';

-- 2. Update group_messages type CHECK constraint to allow 'image'
ALTER TABLE public.group_messages DROP CONSTRAINT IF EXISTS group_messages_type_check;
ALTER TABLE public.group_messages ADD CONSTRAINT group_messages_type_check
  CHECK (type IN ('text', 'hangout_request', 'image'));

-- 3. Increase content length for group_messages to fit image URLs / data URLs
ALTER TABLE public.group_messages DROP CONSTRAINT IF EXISTS group_messages_content_check;
ALTER TABLE public.group_messages ADD CONSTRAINT group_messages_content_check
  CHECK (char_length(content) BETWEEN 1 AND 10000);

-- ============================================================
-- IMPORTANT — Storage bucket (manual step in Supabase dashboard)
-- ============================================================
-- 1. Go to Storage > New bucket
-- 2. Name: chat-images
-- 3. Public: ✅ enabled
-- 4. File size limit: 8 MB
-- 5. Allowed MIME types: image/jpeg, image/png, image/webp, image/gif
-- ============================================================
