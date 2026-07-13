-- Phase 18: optional end dates for events and hangout pools

ALTER TABLE public.community_events
  ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;

ALTER TABLE public.hangout_pools
  ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_community_events_ends_at
  ON public.community_events(ends_at);

CREATE INDEX IF NOT EXISTS idx_hangout_pools_ends_at
  ON public.hangout_pools(ends_at);
