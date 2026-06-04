-- Phase 27: Event Location Coordinates
-- Adds lat/lng columns to community_events for map pin display.

ALTER TABLE community_events
  ADD COLUMN IF NOT EXISTS lat  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lng  DOUBLE PRECISION;

COMMENT ON COLUMN community_events.lat IS
  'Latitude of the event location (set via LocationPicker)';
COMMENT ON COLUMN community_events.lng IS
  'Longitude of the event location (set via LocationPicker)';
