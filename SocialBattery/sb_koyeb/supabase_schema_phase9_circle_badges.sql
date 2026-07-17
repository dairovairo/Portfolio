-- ============================================================
-- SocialBattery - Phase 9: Circle Badges
-- Run this in Supabase SQL Editor after previous schema files.
-- ============================================================

INSERT INTO public.badges (id, name, emoji, description, category) VALUES
  ('lone_wolf',          'Lone Wolf',          '🐺', 'Quien menos se apunta a quedadas dentro del circulo.', 'circle'),
  ('last_one_standing',  'Last One Standing',  '🧍', 'Quien mas pools termina solo, sin que nadie mas se una.', 'circle'),
  ('night_owl',          'Night Owl',          '🦉', 'Quien mantiene mas bateria social por la noche.', 'circle'),
  ('instigator',         'Instigator',         '🔥', 'Quien mas pools crea dentro del circulo.', 'circle'),
  ('last_minute_joiner', 'Last Minute Joiner', '⏱️', 'Quien mas veces entra ultimo a un pool antes de que se cierre.', 'circle'),
  ('early_bird',         'Early Bird',         '🌅', 'Quien tiene mas bateria social por la manana.', 'circle')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  emoji = EXCLUDED.emoji,
  description = EXCLUDED.description,
  category = EXCLUDED.category;

-- These badges are now calculated dynamically by the backend inside each
-- accepted-friends circle. Old permanent user_badges can stay in the table for
-- history, but the app no longer reads them for the badge UI.
