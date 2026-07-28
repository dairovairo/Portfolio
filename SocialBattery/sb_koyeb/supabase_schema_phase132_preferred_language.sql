-- ─────────────────────────────────────────────────────────────────────────────
-- Fase 132 — Idioma preferido del usuario.
--
-- Se añade `users.preferred_language` (text, default 'es') para que el idioma
-- elegido desde Ajustes viaje entre dispositivos: el cliente lo lee al
-- hidratar el perfil (src/context/AuthContext.jsx → LanguageSyncer) y lo
-- reescribe con PATCH /users/me cuando se cambia en Ajustes.
--
-- Constraint: sólo aceptamos los locales soportados por el cliente para
-- evitar drift (si mañana añadimos 'de', hay que ampliar el constraint y
-- meter el diccionario en src/i18n/locales/de.js — el fallback es 'es').
--
-- El backend (POST /auth/profile, PATCH /users/me) también valida el valor
-- antes de escribirlo; el CHECK es una segunda barrera de defensa.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'es';

-- Restringir a los idiomas actualmente soportados por el cliente.
-- Se usa NOT VALID + VALIDATE para no bloquear filas existentes en migraciones
-- antiguas: al llegar con DEFAULT 'es' ya cumplen, pero por si acaso.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_preferred_language_check'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_preferred_language_check
      CHECK (preferred_language IN ('es', 'en', 'fr'));
  END IF;
END $$;
