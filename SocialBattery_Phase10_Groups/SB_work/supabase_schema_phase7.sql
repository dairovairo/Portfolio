-- ══════════════════════════════════════════════════
--  SocialBattery — Schema Fase 7: Insignias
--  Run AFTER supabase_schema.sql + supabase_schema_phase56.sql
--  Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════

-- ── Ensure badges catalog is complete ────────────────────────────────────────
-- (Re-insert in case previous migrations missed some)

INSERT INTO public.badges (id, name, emoji, description, category) VALUES
  ('night_owl',        'Noctámbulo',         '🦉', 'Actualiza tu batería después de las 22h',        'tiempo'),
  ('early_bird',       'Madrugador Social',  '☀️', 'Actualiza tu batería antes de las 9h',           'tiempo'),
  ('low_battery_hero', 'Batería Crítica',    '🪫', 'Registrado con batería al 10% o menos',          'bateria'),
  ('fully_charged',    'Al 100%',            '⚡', 'Registrado con batería al máximo',               'bateria'),
  ('weekend_warrior',  'Guerrero del Finde', '🎉', 'Activo los fines de semana',                     'tiempo'),
  ('consistent_7',     'Constante',          '🔋', '7 días seguidos actualizando tu batería',        'habito'),
  ('organizer_5',      'Organizador Nato',   '📅', 'Has creado 5 o más pools de quedada',            'social'),
  ('introvert_proud',  'Introvertido Feliz', '🧘', '10 o más días con batería por debajo del 30%',  'bateria'),
  ('social_butterfly', 'Mariposa Social',    '🦋', '10 o más días con batería por encima del 80%',  'bateria'),
  ('connector',        'Conector',           '🤝', 'Tienes 10 o más amigos en SocialBattery',        'social')
ON CONFLICT (id) DO UPDATE SET
  name        = EXCLUDED.name,
  emoji       = EXCLUDED.emoji,
  description = EXCLUDED.description,
  category    = EXCLUDED.category;

-- ── Row Level Security: badges (catalog — public read) ────────────────────────
ALTER TABLE public.badges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Badges catalog is public" ON public.badges;
CREATE POLICY "Badges catalog is public" ON public.badges
  FOR SELECT USING (TRUE);

-- Only service role can insert/update/delete catalog (managed by migrations)

-- ── Row Level Security: user_badges ──────────────────────────────────────────
ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;

-- SELECT: a user can see their own badges, and anyone can see friends' badges
DROP POLICY IF EXISTS "Users can see their own badges" ON public.user_badges;
CREATE POLICY "Users can see their own badges" ON public.user_badges
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.are_friends(user_id)
    OR EXISTS (
      SELECT 1 FROM public.users WHERE id = user_id
      -- Any authenticated user can view earned badges (public profile feature)
    )
  );

-- More permissive: all authenticated users can see anyone's earned badges
-- (badges are a public personality signal — that's the product intent)
DROP POLICY IF EXISTS "Earned badges are publicly visible" ON public.user_badges;
CREATE POLICY "Earned badges are publicly visible" ON public.user_badges
  FOR SELECT USING (auth.role() = 'authenticated');

-- INSERT: only the server (service_role) awards badges — users cannot self-award
-- The backend uses the service_role key via supabase-js on the server
-- so no INSERT policy is needed for anon/authenticated roles.

-- ── Realtime: user_badges ─────────────────────────────────────────────────────
-- Clients subscribe to their own badge unlocks for instant celebration UI
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_badges;

-- ── Index: speed up user_badges lookups ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_user_badges_user
  ON public.user_badges(user_id, earned_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_badges_badge
  ON public.user_badges(badge_id);

-- ── Helper: get all badges with earned status for a user (useful for RPC) ────
CREATE OR REPLACE FUNCTION public.get_badges_for_user(target_user_id UUID)
RETURNS TABLE (
  id          TEXT,
  name        TEXT,
  emoji       TEXT,
  description TEXT,
  category    TEXT,
  earned_at   TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    b.id, b.name, b.emoji, b.description, b.category,
    ub.earned_at
  FROM public.badges b
  LEFT JOIN public.user_badges ub
    ON ub.badge_id = b.id AND ub.user_id = target_user_id
  ORDER BY b.category, b.id;
$$;

-- ══════════════════════════════════════════════════
--  DONE — Phase 7 schema applied
-- ══════════════════════════════════════════════════
