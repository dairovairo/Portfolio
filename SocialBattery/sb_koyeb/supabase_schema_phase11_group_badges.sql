-- ============================================================
-- SocialBattery - Phase 11: Group Badges
-- Run this in Supabase SQL Editor after phase10.
-- ============================================================
-- Las insignias ahora funcionan por grupo privado de amigos:
--   · Cada insignia tiene UN solo titular por grupo (exclusiva).
--   · Una persona SÍ puede tener varias insignias en el mismo grupo.
--   · Si hay empate, tiene prioridad quien no tenga ninguna insignia.
--   · Al ganar una insignia en un grupo, se guarda de forma permanente
--     en user_badges y es visible públicamente en el perfil.
-- ============================================================

-- Asegurar que la tabla user_badges tiene la política correcta
-- para que el servidor (service role) pueda insertar insignias ganadas.
-- El service role de Supabase bypasea RLS automáticamente, así que
-- solo añadimos un índice de rendimiento si no existe ya.

CREATE INDEX IF NOT EXISTS idx_user_badges_user ON public.user_badges(user_id);
CREATE INDEX IF NOT EXISTS idx_user_badges_badge ON public.user_badges(badge_id);

-- Aseguramos que las insignias de círculo existen en el catálogo
-- (pueden haberse insertado ya en phase9, pero ON CONFLICT DO UPDATE
-- garantiza que los datos estén actualizados)
INSERT INTO public.badges (id, name, emoji, description, category) VALUES
  ('lone_wolf',          'Lone Wolf',          '🐺', 'Quien menos se apunta a quedadas dentro del grupo.', 'circle'),
  ('last_one_standing',  'Last One Standing',  '🧍', 'Quien mas pools termina solo, sin que nadie mas se una.', 'circle'),
  ('night_owl',          'Night Owl',          '🦉', 'Quien mantiene mas bateria social por la noche.', 'circle'),
  ('instigator',         'Instigator',         '🔥', 'Quien mas pools crea dentro del grupo.', 'circle'),
  ('last_minute_joiner', 'Last Minute Joiner', '⏱️', 'Quien mas veces entra ultimo a un pool antes de que se cierre.', 'circle'),
  ('early_bird',         'Early Bird',         '🌅', 'Quien tiene mas bateria social por la manana.', 'circle')
ON CONFLICT (id) DO UPDATE SET
  name        = EXCLUDED.name,
  emoji       = EXCLUDED.emoji,
  description = EXCLUDED.description,
  category    = EXCLUDED.category;
