-- ══════════════════════════════════════════════════
--  SocialBattery — Fase 117: Icono de "Last Minute Joiner" en línea
--  Run this in: Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════
-- Cambio en server/lib/circleBadges.js: el emoji de 'last_minute_joiner'
-- pasa de '⏱️' (U+23F1 + U+FE0F, forzado a color) a '⏱' (U+23F1 solo),
-- que por defecto cae en presentación de línea/monocromo — igual que el
-- resto de símbolos de línea del proyecto (🔓︎/🔒︎/⚙︎). Esta migración
-- sincroniza la tabla public.badges, que es la que usa el toast de
-- desbloqueo (ver GET/POST /api/battery en server/routes/battery.js).

UPDATE public.badges SET emoji = '⏱' WHERE id = 'last_minute_joiner';

NOTIFY pgrst, 'reload schema';
