-- Phase 25: Event Promotion Plans
-- Adds a promotion_plan column to community_events
-- Allowed values: 'basic' (free), 'premium' (€10), 'ultra' (€20)

ALTER TABLE community_events
  ADD COLUMN IF NOT EXISTS promotion_plan TEXT NOT NULL DEFAULT 'basic'
    CHECK (promotion_plan IN ('basic', 'premium', 'ultra'));

COMMENT ON COLUMN community_events.promotion_plan IS
  'Promotion tier chosen at creation time: basic (free), premium (€10), ultra (€20)';
