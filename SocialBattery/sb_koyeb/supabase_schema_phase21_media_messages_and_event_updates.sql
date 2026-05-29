-- Phase 21: image attachments in chats and event update threads

ALTER TYPE public.message_type ADD VALUE IF NOT EXISTS 'image';

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS image_url TEXT;

ALTER TABLE public.messages
  ALTER COLUMN content DROP NOT NULL;

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_content_or_image_check;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_content_or_image_check
  CHECK (
    (type::TEXT = 'image' AND image_url IS NOT NULL)
    OR (content IS NOT NULL AND char_length(trim(content)) > 0)
  );

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
  DROP CONSTRAINT IF EXISTS group_messages_content_or_image_check;

ALTER TABLE public.group_messages
  ADD CONSTRAINT group_messages_content_or_image_check
  CHECK (
    (type = 'image' AND image_url IS NOT NULL)
    OR (content IS NOT NULL AND char_length(trim(content)) > 0)
  );

ALTER TABLE public.event_updates
  ADD COLUMN IF NOT EXISTS image_url TEXT;

ALTER TABLE public.event_updates
  ALTER COLUMN content DROP NOT NULL;

ALTER TABLE public.event_updates
  DROP CONSTRAINT IF EXISTS event_updates_content_check;

ALTER TABLE public.event_updates
  DROP CONSTRAINT IF EXISTS event_updates_content_or_image_check;

ALTER TABLE public.event_updates
  ADD CONSTRAINT event_updates_content_or_image_check
  CHECK (
    image_url IS NOT NULL
    OR (content IS NOT NULL AND char_length(trim(content)) >= 1)
  );
