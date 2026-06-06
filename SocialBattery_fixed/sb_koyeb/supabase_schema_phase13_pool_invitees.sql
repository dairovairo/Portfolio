-- ── Phase 13: Pool invitees — individual friend invites for private pools ─────
-- Run this after supabase_schema_phase10_groups.sql

-- Table: explicit per-user invites for private pools
CREATE TABLE IF NOT EXISTS pool_invitees (
  pool_id    UUID NOT NULL REFERENCES hangout_pools(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (pool_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_pool_invitees_user   ON pool_invitees(user_id);
CREATE INDEX IF NOT EXISTS idx_pool_invitees_pool   ON pool_invitees(pool_id);

-- RLS: service role handles everything through the API
ALTER TABLE pool_invitees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pool_invitees_all" ON pool_invitees FOR ALL USING (true) WITH CHECK (true);
