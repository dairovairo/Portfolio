-- ============================================================
-- PHASE 10: Friend Groups + Group Chat + Private Pools
-- Run this in Supabase SQL Editor
-- ============================================================

-- ── 1. Friend groups ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS friend_groups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. Group members (owner is also a member) ─────────────────
CREATE TABLE IF NOT EXISTS friend_group_members (
  group_id  UUID NOT NULL REFERENCES friend_groups(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);

-- ── 3. Group messages ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS group_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   UUID NOT NULL REFERENCES friend_groups(id) ON DELETE CASCADE,
  sender_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  type       TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'hangout_request')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 4. Add group_id to hangout_pools (private pools) ─────────
ALTER TABLE hangout_pools
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES friend_groups(id) ON DELETE SET NULL;

-- ── 5. Indexes ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_friend_groups_owner ON friend_groups(owner_id);
CREATE INDEX IF NOT EXISTS idx_friend_group_members_user ON friend_group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_group_messages_group ON group_messages(group_id, created_at);
CREATE INDEX IF NOT EXISTS idx_hangout_pools_group ON hangout_pools(group_id);

-- ── 6. RLS ────────────────────────────────────────────────────
ALTER TABLE friend_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE friend_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_messages ENABLE ROW LEVEL SECURITY;

-- friend_groups: readable by members, writable by owner
CREATE POLICY "group members can read" ON friend_groups
  FOR SELECT USING (
    id IN (SELECT group_id FROM friend_group_members WHERE user_id = auth.uid())
  );
CREATE POLICY "owner can manage group" ON friend_groups
  FOR ALL USING (owner_id = auth.uid());

-- friend_group_members: readable by group members
CREATE POLICY "members can read members" ON friend_group_members
  FOR SELECT USING (
    group_id IN (SELECT group_id FROM friend_group_members WHERE user_id = auth.uid())
  );
CREATE POLICY "owner can manage members" ON friend_group_members
  FOR ALL USING (
    group_id IN (SELECT id FROM friend_groups WHERE owner_id = auth.uid())
  );

-- group_messages: readable and writable by group members
CREATE POLICY "members can read messages" ON group_messages
  FOR SELECT USING (
    group_id IN (SELECT group_id FROM friend_group_members WHERE user_id = auth.uid())
  );
CREATE POLICY "members can send messages" ON group_messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid() AND
    group_id IN (SELECT group_id FROM friend_group_members WHERE user_id = auth.uid())
  );
