-- ============================================================
-- SocialBattery — Phase 78: Me gusta + Eliminar en chats de
-- grupo, quedada (pool) y comunidad
-- Run this in Supabase SQL Editor
-- ============================================================
-- Mismo patrón que las mensajes 1:1 (phase 12 deleted_for_*,
-- phase 32 liked_by), aplicado a group_messages, pool_messages
-- y community_messages.

-- ── group_messages ────────────────────────────────────────────
ALTER TABLE public.group_messages
  ADD COLUMN IF NOT EXISTS liked_by UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
ALTER TABLE public.group_messages
  ADD COLUMN IF NOT EXISTS deleted_for_self UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
ALTER TABLE public.group_messages
  ADD COLUMN IF NOT EXISTS deleted_for_everyone BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.group_messages
  ADD COLUMN IF NOT EXISTS deleted_for_everyone_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_group_messages_liked_by ON public.group_messages USING GIN (liked_by);

-- ── pool_messages ─────────────────────────────────────────────
ALTER TABLE public.pool_messages
  ADD COLUMN IF NOT EXISTS liked_by UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
ALTER TABLE public.pool_messages
  ADD COLUMN IF NOT EXISTS deleted_for_self UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
ALTER TABLE public.pool_messages
  ADD COLUMN IF NOT EXISTS deleted_for_everyone BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.pool_messages
  ADD COLUMN IF NOT EXISTS deleted_for_everyone_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_pool_messages_liked_by ON public.pool_messages USING GIN (liked_by);

-- ── community_messages ───────────────────────────────────────
ALTER TABLE public.community_messages
  ADD COLUMN IF NOT EXISTS liked_by UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
ALTER TABLE public.community_messages
  ADD COLUMN IF NOT EXISTS deleted_for_self UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
ALTER TABLE public.community_messages
  ADD COLUMN IF NOT EXISTS deleted_for_everyone BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.community_messages
  ADD COLUMN IF NOT EXISTS deleted_for_everyone_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_community_messages_liked_by ON public.community_messages USING GIN (liked_by);

-- No cambios de RLS: las políticas de SELECT existentes ya cubren estas
-- columnas nuevas, y el UPDATE (like/delete) se hace server-side con el
-- cliente de servicio (bypassa RLS), igual que el resto de endpoints de
-- estos routers.
