-- Phase 21: Media support for event updates and image messages
-- Run this in your Supabase SQL editor

-- Add image_url to event_updates
ALTER TABLE event_updates ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Add 'image' value to the message_type enum (if it exists as enum)
DO $$
BEGIN
  -- For messages table enum
  IF EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'message_type'
  ) THEN
    ALTER TYPE message_type ADD VALUE IF NOT EXISTS 'image';
  END IF;
END$$;

-- If type columns are plain text with CHECK constraints, drop and recreate them
-- (only runs if the enum approach above wasn't applicable)
DO $$
BEGIN
  -- messages table
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'message_type'
  ) THEN
    ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_type_check;
    ALTER TABLE messages ADD CONSTRAINT messages_type_check
      CHECK (type IN ('text', 'hangout_request', 'image'));

    ALTER TABLE group_messages DROP CONSTRAINT IF EXISTS group_messages_type_check;
    ALTER TABLE group_messages ADD CONSTRAINT group_messages_type_check
      CHECK (type IN ('text', 'hangout_request', 'image'));
  END IF;
END$$;
