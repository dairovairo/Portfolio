-- ============================================================
-- SocialBattery — Phase 130: terms_accepted_at en users
-- Run this in Supabase SQL Editor
-- ============================================================
-- La aceptación de Términos+Privacidad+edad mínima tiene que ser
-- verificable en la BD, no solo un checkbox del cliente. Motivo real que
-- destapó el bug:
--
--   El cliente exige el checkbox en el tab "Registro" antes del signUp.
--   Pero si un usuario nuevo pulsa "Continuar con Google" desde el tab
--   "Entrar" (natural para gente que usa Google en todo), Supabase le
--   crea la cuenta al vuelo — sin aceptación previa. Cerrar esa puerta en
--   el cliente rompe la UX de los usuarios que SÍ tienen cuenta.
--
-- La solución limpia: guardar en la fila del usuario cuándo aceptó, y
-- bloquear el uso de la app hasta que lo haga. Sirve tanto para email
-- como para OAuth (Google/Apple), y sea el flujo de "Entrar" o "Registro".
--
-- Columna nullable a propósito:
--   - null → nunca ha aceptado → el cliente le mostrará la pantalla de
--     aceptación obligatoria antes de dejarle usar la app.
--   - timestamptz → aceptó en ese momento.
--
-- Nota: no distinguimos versiones de los ToS. Si algún día publicas una
-- revisión grande, añades otra columna (`terms_version`) y comparas con
-- la versión vigente. Por ahora es innecesario.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;

-- Backfill para cuentas creadas antes de este cambio: si tienes una app
-- ya lanzada con usuarios reales, comenta esta línea y decide caso por
-- caso (podrías forzar re-aceptación, o dejarlas "aceptadas retro").
-- Para SocialBattery pre-launch, las cuentas existentes son testers
-- tuyos, así que las marcamos como aceptadas para no molestarles.
UPDATE public.users
   SET terms_accepted_at = NOW()
 WHERE terms_accepted_at IS NULL;

-- Índice muy ligero para no escanear toda la tabla si algún día haces un
-- report de "usuarios pendientes de aceptar" (solo indexa las filas null).
CREATE INDEX IF NOT EXISTS idx_users_terms_not_accepted
  ON public.users(id) WHERE terms_accepted_at IS NULL;
