-- ── Realtime fix: add group tables to publication ─────────────────────────────
-- Run this once in the Supabase SQL Editor.
-- Without this, postgres_changes subscriptions on group_messages and
-- friend_groups never fire because the tables aren't in the publication.

ALTER PUBLICATION supabase_realtime ADD TABLE public.group_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.friend_groups;
ALTER PUBLICATION supabase_realtime ADD TABLE public.friend_group_members;
