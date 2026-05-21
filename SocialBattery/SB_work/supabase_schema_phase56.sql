-- ══════════════════════════════════════════════════
--  SocialBattery — Schema Additions: Fases 5 & 6
--  Run AFTER supabase_schema.sql (phases 1–4)
--  Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════

-- ── Fase 5: Hangout Pools — Row Level Security ───────────────────────────────
-- (Tables already created in base schema; these policies were missing)

-- Helper: returns TRUE if the current user is friends with `other_id`
CREATE OR REPLACE FUNCTION public.are_friends(other_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.friendships
    WHERE status = 'accepted'
      AND (
        (requester_id = auth.uid() AND addressee_id = other_id)
        OR
        (requester_id = other_id AND addressee_id = auth.uid())
      )
  );
$$;

-- hangout_pools — SELECT
-- You can see a pool if: it's public, or its creator is a friend, or you created it
DROP POLICY IF EXISTS "Pools visible to friends or public" ON public.hangout_pools;
CREATE POLICY "Pools visible to friends or public" ON public.hangout_pools
  FOR SELECT USING (
    is_public = TRUE
    OR creator_id = auth.uid()
    OR public.are_friends(creator_id)
    OR EXISTS (
      SELECT 1 FROM public.pool_participants pp
      WHERE pp.pool_id = id AND pp.user_id = auth.uid()
    )
  );

-- hangout_pools — INSERT
DROP POLICY IF EXISTS "Authenticated users can create pools" ON public.hangout_pools;
CREATE POLICY "Authenticated users can create pools" ON public.hangout_pools
  FOR INSERT WITH CHECK (auth.uid() = creator_id);

-- hangout_pools — UPDATE (creator only)
DROP POLICY IF EXISTS "Creator can update pool" ON public.hangout_pools;
CREATE POLICY "Creator can update pool" ON public.hangout_pools
  FOR UPDATE USING (auth.uid() = creator_id);

-- hangout_pools — DELETE (creator only)
DROP POLICY IF EXISTS "Creator can delete pool" ON public.hangout_pools;
CREATE POLICY "Creator can delete pool" ON public.hangout_pools
  FOR DELETE USING (auth.uid() = creator_id);

-- pool_participants — SELECT
-- Visible if you can see the pool
DROP POLICY IF EXISTS "Pool participants visible to pool viewers" ON public.pool_participants;
CREATE POLICY "Pool participants visible to pool viewers" ON public.pool_participants
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.hangout_pools hp
      WHERE hp.id = pool_id
        AND (
          hp.is_public = TRUE
          OR hp.creator_id = auth.uid()
          OR public.are_friends(hp.creator_id)
        )
    )
  );

-- pool_participants — INSERT (join a pool you can see)
DROP POLICY IF EXISTS "Users can join visible pools" ON public.pool_participants;
CREATE POLICY "Users can join visible pools" ON public.pool_participants
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.hangout_pools hp
      WHERE hp.id = pool_id
        AND hp.status IN ('open', 'full')
        AND (
          hp.is_public = TRUE
          OR hp.creator_id = auth.uid()
          OR public.are_friends(hp.creator_id)
        )
    )
  );

-- pool_participants — DELETE (leave a pool)
DROP POLICY IF EXISTS "Users can leave pools" ON public.pool_participants;
CREATE POLICY "Users can leave pools" ON public.pool_participants
  FOR DELETE USING (auth.uid() = user_id);

-- ── Fase 5: Realtime for Pools ───────────────────────────────────────────────
-- Add pools tables to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.hangout_pools;
ALTER PUBLICATION supabase_realtime ADD TABLE public.pool_participants;

-- ── Fase 6: Battery estimation — helper view ─────────────────────────────────
-- Optional: a view to quickly check which users need estimation
-- (The cron job in the server already handles this, but this is useful for debugging)
CREATE OR REPLACE VIEW public.users_needing_estimate AS
  SELECT u.id, u.username, u.battery_updated_at, u.battery_is_estimated,
         COUNT(bh.id) FILTER (
           WHERE bh.day_of_week = EXTRACT(DOW FROM NOW())::int
         ) AS history_count_today_dow
  FROM public.users u
  LEFT JOIN public.battery_history bh ON bh.user_id = u.id
  WHERE (
    u.battery_updated_at IS NULL
    OR u.battery_updated_at < date_trunc('day', NOW())
  )
  GROUP BY u.id
  HAVING COUNT(bh.id) FILTER (
    WHERE bh.day_of_week = EXTRACT(DOW FROM NOW())::int
  ) >= 2;

-- ── Indexes for performance ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pool_participants_pool
  ON public.pool_participants(pool_id);

CREATE INDEX IF NOT EXISTS idx_pool_participants_user
  ON public.pool_participants(user_id);

CREATE INDEX IF NOT EXISTS idx_pools_public_open
  ON public.hangout_pools(is_public, status, scheduled_at)
  WHERE is_public = TRUE AND status IN ('open', 'full');
