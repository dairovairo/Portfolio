-- ============================================================
-- SocialBattery — Phase 131: is_admin en users (panel de denuncias)
-- Run this in Supabase SQL Editor
-- ============================================================
-- Flag mínimo para poder acceder a /admin/reports (panel de revisión de
-- denuncias, ver server/routes/admin.js y client/src/pages/AdminReportsPage.jsx).
-- No es un sistema de roles completo a propósito — con un solo owner
-- revisando denuncias, un booleano es suficiente y no añade superficie de
-- ataque innecesaria. Si el equipo crece, se puede migrar a una tabla de
-- roles sin tocar el resto del esquema.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

-- Márcate a ti mismo como admin. Sustituye el email por el tuyo antes de
-- ejecutar.
UPDATE public.users
   SET is_admin = true
 WHERE id = (SELECT id FROM auth.users WHERE email = 'TU_EMAIL_AQUI@ejemplo.com');
