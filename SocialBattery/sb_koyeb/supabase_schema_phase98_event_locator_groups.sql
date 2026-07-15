-- ============================================================
-- SocialBattery — Phase 98: Grupos de localización de evento
-- Run this in Supabase SQL Editor
-- ============================================================
-- Botón "Crear grupo de localización" dentro del modo Locator
-- (EventLocatorPage.jsx). El creador del grupo (cualquier asistente del
-- evento) invita a una selección de sus amigos que también van al evento;
-- el resto puede ver el mapa igualmente, pero solo estos forman parte del
-- grupo de localización. Un solo grupo por evento (UNIQUE en event_id) —
-- si ya existe, la página muestra la lista de miembros en vez del botón de
-- creación.

CREATE TABLE IF NOT EXISTS public.event_locator_groups (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID        NOT NULL REFERENCES public.community_events(id) ON DELETE CASCADE,
  creator_id UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id)
);

CREATE TABLE IF NOT EXISTS public.event_locator_group_members (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     UUID        NOT NULL REFERENCES public.event_locator_groups(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status       TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  UNIQUE (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_locator_group_members_group
  ON public.event_locator_group_members(group_id);

CREATE INDEX IF NOT EXISTS idx_event_locator_group_members_user
  ON public.event_locator_group_members(user_id);

-- ── RLS ────────────────────────────────────────────────────────
-- El backend usa el cliente de servicio (bypassa RLS) para todo el CRUD,
-- igual que el resto de endpoints de comunidad/eventos. Estas políticas de
-- lectura son solo una capa extra de defensa por si algún día se leen estas
-- tablas con el cliente del propio usuario — mismo criterio que
-- community_posts (fase 94).
ALTER TABLE public.event_locator_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_locator_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event attendees can read locator groups" ON public.event_locator_groups;
CREATE POLICY "event attendees can read locator groups" ON public.event_locator_groups
  FOR SELECT USING (
    event_id IN (SELECT event_id FROM public.community_event_attendees WHERE user_id = auth.uid())
    OR creator_id = auth.uid()
  );

DROP POLICY IF EXISTS "group members can read their membership rows" ON public.event_locator_group_members;
CREATE POLICY "group members can read their membership rows" ON public.event_locator_group_members
  FOR SELECT USING (
    group_id IN (SELECT id FROM public.event_locator_groups WHERE creator_id = auth.uid())
    OR user_id = auth.uid()
  );

NOTIFY pgrst, 'reload schema';
