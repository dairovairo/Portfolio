-- ============================================================
-- SocialBattery — Phase 79: Sorteos de comunidad
-- Run this in Supabase SQL Editor
-- ============================================================
-- Solo el CREADOR de la comunidad puede crear y sortear un sorteo.
-- Participan todos los miembros de la comunidad salvo los que
-- tengan rol 'admin' (normalmente solo el propio creador).

CREATE TABLE IF NOT EXISTS public.community_raffles (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID        NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  creator_id   UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title        TEXT        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  description  TEXT        CHECK (description IS NULL OR char_length(description) <= 1000),
  image_url    TEXT,
  ends_at      TIMESTAMPTZ NOT NULL,
  winner_id    UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  drawn_at     TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_community_raffles_community
  ON public.community_raffles(community_id, created_at DESC);

-- ── RLS ────────────────────────────────────────────────────────
-- El backend usa el cliente de servicio (bypassa RLS) para crear, listar
-- y sortear, igual que el resto de endpoints de comunidad. Esta política
-- de lectura es solo una capa extra de defensa por si algún día se lee
-- esta tabla con el cliente del propio usuario.
ALTER TABLE public.community_raffles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "community members can read raffles" ON public.community_raffles;
CREATE POLICY "community members can read raffles" ON public.community_raffles
  FOR SELECT USING (
    community_id IN (SELECT community_id FROM public.community_members WHERE user_id = auth.uid())
  );

NOTIFY pgrst, 'reload schema';
