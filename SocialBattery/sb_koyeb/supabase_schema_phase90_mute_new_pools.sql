-- ============================================================
-- SocialBattery — Phase 90: Silenciar nuevas quedadas (ajuste global)
-- Run this in Supabase SQL Editor
-- ============================================================
-- El toggle "Silenciar nuevas quedadas" de Ajustes > Notificaciones vivía
-- solo en localStorage (SettingsContext) y nunca se consultaba en ningún
-- sitio, así que no bloqueaba nada. La notificación real de "X propone una
-- quedada" es un web-push del servidor (notifyUsers en routes/pools.js) que
-- llega igual con la app en foreground o background/cerrada (bug #1 del
-- fase comentado en ese archivo), así que el filtro tiene que aplicarse ahí,
-- server-side, y por tanto el ajuste necesita persistir en la fila del
-- usuario — no basta con localStorage. Mismo patrón que show_interests /
-- show_public_stats / show_badges (PATCH /users/me + syncPrivacyFromProfile).

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS mute_new_pools boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
