-- Phase 23: per-attendee reminder lead time for events and hangout pools
-- Values are stored in minutes before the start time.
-- Defaults keep the current behavior: pools 10 minutes, events 24 hours.

ALTER TABLE public.pool_participants
  ADD COLUMN IF NOT EXISTS reminder_minutes_before INTEGER NOT NULL DEFAULT 10;

ALTER TABLE public.community_event_attendees
  ADD COLUMN IF NOT EXISTS reminder_minutes_before INTEGER NOT NULL DEFAULT 1440;

ALTER TABLE public.pool_participants
  DROP CONSTRAINT IF EXISTS pool_participants_reminder_minutes_before_check;

ALTER TABLE public.pool_participants
  ADD CONSTRAINT pool_participants_reminder_minutes_before_check
  CHECK (reminder_minutes_before BETWEEN 10 AND 10080);

ALTER TABLE public.community_event_attendees
  DROP CONSTRAINT IF EXISTS community_event_attendees_reminder_minutes_before_check;

ALTER TABLE public.community_event_attendees
  ADD CONSTRAINT community_event_attendees_reminder_minutes_before_check
  CHECK (reminder_minutes_before BETWEEN 10 AND 10080);

CREATE INDEX IF NOT EXISTS idx_pool_participants_reminder
  ON public.pool_participants(reminder_minutes_before);

CREATE INDEX IF NOT EXISTS idx_community_event_attendees_reminder
  ON public.community_event_attendees(reminder_minutes_before);
