-- ============================================================
-- SocialBattery — Phase 115: Revamp de insignias de círculo/grupo/quedada
-- Run this in Supabase SQL Editor
-- ============================================================
-- Cambios en server/lib/circleBadges.js:
--
-- 1) Renombrado (mismo id, mismo criterio, solo cambia el nombre visible
--    — igual que "tapado" → "Average Joe/Jane" en la fase 62, para no
--    romper las filas ya existentes en user_badges):
--      'lone_wolf'  : "Lone Wolf"  → "Couch Potato"  (menos se apunta a quedadas)
--      'instigator' : "Instigator" → "Connector"     (más pools crea)
--
-- 2) Insignias nuevas:
--      'few_friends'  : "Lone Wolf"     — menos amigos tiene en la app
--                        (reutiliza el nombre "Lone Wolf" con un criterio
--                        nuevo, por eso necesita un id distinto al de
--                        arriba en vez de reciclar 'lone_wolf')
--      'people_magnet': "People Magnet" — más amigos tiene en la app
--      'early_joiner' : "Early Joiner"  — primero en apuntarse a quedadas
--      'late_legend'  : "Late Legend"   — de los que llegan, quien más
--                        veces llega el último (según check-ins de Sniffer)
--      'ghost'        : "Ghost"         — se apunta y menos se presenta

-- 3) Corrección de vocabulario: las descripciones de la fase 9 usaban
--    "pool"/"pools" en vez de "quedada"/"quedadas" (la app entera usa
--    "quedada"). last_minute_joiner ya se corrige de forma completa más
--    abajo porque no cambia de nombre; instigator/last_one_standing solo
--    necesitan este UPDATE de texto (su nombre ya se toca arriba o se
--    queda igual).

UPDATE public.badges SET name = 'Couch Potato', emoji = '🥔' WHERE id = 'lone_wolf';
UPDATE public.badges SET name = 'Connector', description = 'Quien mas quedadas crea dentro del circulo.' WHERE id = 'instigator';
UPDATE public.badges SET description = 'Quien mas quedadas termina solo, sin que nadie mas se una.' WHERE id = 'last_one_standing';
UPDATE public.badges SET description = 'Quien mas veces entra ultimo a una quedada antes de que se cierre.' WHERE id = 'last_minute_joiner';

INSERT INTO public.badges (id, name, emoji, description, category) VALUES
  ('few_friends',   'Lone Wolf',      '🐺', 'Quien menos amigos tiene en la app.', 'circle'),
  ('people_magnet', 'People Magnet',  '🧲', 'Quien mas amigos tiene en la app.', 'circle'),
  ('early_joiner',  'Early Joiner',   '🥇', 'Quien mas veces es el primero en apuntarse a una quedada.', 'circle'),
  ('late_legend',   'Late Legend',    '🐢', 'Quien mas veces llega el ultimo a las quedadas (de los que llegan).', 'circle'),
  ('ghost',         'Ghost',          '👻', 'Quien mas se apunta a quedadas y menos se presenta.', 'circle')
ON CONFLICT (id) DO UPDATE SET
  name        = EXCLUDED.name,
  emoji       = EXCLUDED.emoji,
  description = EXCLUDED.description,
  category    = EXCLUDED.category;

NOTIFY pgrst, 'reload schema';
