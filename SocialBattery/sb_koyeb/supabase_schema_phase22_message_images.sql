-- ============================================================
-- SocialBattery - Phase 22: Image Messages in Chat
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Add 'image' value to message_type ENUM (individual DMs).
-- Use type::text in constraints because PostgreSQL cannot safely compare
-- against a freshly-added enum value inside the same transaction.
ALTER TYPE public.message_type ADD VALUE IF NOT EXISTS 'image';

-- 2. Direct messages: support either the legacy content-as-image-url shape
-- or the newer image_url column.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS image_url TEXT;

ALTER TABLE public.messages
  ALTER COLUMN content DROP NOT NULL;

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_content_check;

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_content_or_image_check;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_content_or_image_check
  CHECK (
    (
      type::text = 'image'
      AND COALESCE(NULLIF(trim(image_url), ''), NULLIF(trim(content), '')) IS NOT NULL
    )
    OR (
      type::text <> 'image'
      AND content IS NOT NULL
      AND char_length(trim(content)) >= 1
    )
  );

-- 3. Group messages: allow image type and optional text when image_url exists.
ALTER TABLE public.group_messages
  ADD COLUMN IF NOT EXISTS image_url TEXT;

ALTER TABLE public.group_messages
  ALTER COLUMN content DROP NOT NULL;

ALTER TABLE public.group_messages
  DROP CONSTRAINT IF EXISTS group_messages_type_check;

ALTER TABLE public.group_messages
  ADD CONSTRAINT group_messages_type_check
  CHECK (type IN ('text', 'hangout_request', 'image'));

ALTER TABLE public.group_messages
  DROP CONSTRAINT IF EXISTS group_messages_content_check;

ALTER TABLE public.group_messages
  DROP CONSTRAINT IF EXISTS group_messages_content_or_image_check;

ALTER TABLE public.group_messages
  ADD CONSTRAINT group_messages_content_or_image_check
  CHECK (
    (
      type = 'image'
      AND COALESCE(NULLIF(trim(image_url), ''), NULLIF(trim(content), '')) IS NOT NULL
    )
    OR (
      type <> 'image'
      AND content IS NOT NULL
      AND char_length(trim(content)) >= 1
    )
  );

-- ============================================================
-- IMPORTANT - Storage bucket (manual step in Supabase dashboard)
-- ============================================================
-- 1. Go to Storage > New bucket
-- 2. Name: chat-images
-- 3. Public: enabled
-- 4. File size limit: 8 MB
-- 5. Allowed MIME types: image/jpeg, image/png, image/webp, image/gif
-- ============================================================
