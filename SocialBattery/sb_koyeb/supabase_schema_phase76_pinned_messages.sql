-- ============================================================
-- SocialBattery — Phase 76: Mensajes fijados
-- Run this in Supabase SQL Editor
-- ============================================================
-- Permite fijar un mensaje por chat en grupos, comunidades y quedadas.
-- El "administrador" de cada chat puede fijar/desfijar:
--   - Grupo:    el dueño (friend_groups.owner_id)
--   - Quedada:  el creador (hangout_pools.creator_id)
--   - Comunidad: admin o moderador (community_members.role)
-- Se guarda un único mensaje fijado por chat (igual que WhatsApp/Telegram
-- en su vista simple), como referencia al mensaje + quién y cuándo lo fijó.

-- ── 1. Grupos ──────────────────────────────────────────────────
ALTER TABLE public.friend_groups
  ADD COLUMN IF NOT EXISTS pinned_message_id UUID REFERENCES public.group_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pinned_by         UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pinned_at         TIMESTAMPTZ;

-- ── 2. Comunidades ─────────────────────────────────────────────
ALTER TABLE public.communities
  ADD COLUMN IF NOT EXISTS pinned_message_id UUID REFERENCES public.community_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pinned_by         UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pinned_at         TIMESTAMPTZ;

-- ── 3. Quedadas ────────────────────────────────────────────────
ALTER TABLE public.hangout_pools
  ADD COLUMN IF NOT EXISTS pinned_message_id UUID REFERENCES public.pool_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pinned_by         UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pinned_at         TIMESTAMPTZ;

-- Nota: friend_groups, communities y hangout_pools ya están añadidas a la
-- publicación supabase_realtime (Phases realtime_groups_fix, 13 y 56), así
-- que los UPDATE de estas columnas ya disparan postgres_changes sin pasos
-- adicionales.
