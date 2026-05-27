-- Phase 21: Media support for event updates and image messages
-- Run this in your Supabase SQL editor

-- Add image_url to event_updates
ALTER TABLE event_updates ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Allow 'image' type in messages
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_type_check
  CHECK (type IN ('text', 'hangout_request', 'image'));

-- Allow 'image' type in group_messages
ALTER TABLE group_messages DROP CONSTRAINT IF EXISTS group_messages_type_check;
ALTER TABLE group_messages ADD CONSTRAINT group_messages_type_check
  CHECK (type IN ('text', 'hangout_request', 'image'));
