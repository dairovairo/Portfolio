-- ============================================================
-- SocialBattery — Phase 63: Nombre personalizable de la mascota
-- Run this in Supabase SQL Editor
-- ============================================================
-- Añade una columna para que cada usuario pueda ponerle un nombre a su
-- mascota (por defecto "Volty"), editable desde ProfilePage con el mismo
-- botón "Editar" que ya existe para bio/intereses.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS mascot_name TEXT NOT NULL DEFAULT 'Volty';
