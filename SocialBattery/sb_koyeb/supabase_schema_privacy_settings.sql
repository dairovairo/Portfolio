-- ── Migración: columnas de privacidad en tabla users ──────────────────────────
-- Ejecutar en el SQL Editor de Supabase
-- Añade soporte real para: mostrar en línea, mostrar última vez, confirmación de lectura

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS privacy_show_online    BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS privacy_show_last_seen BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS privacy_read_receipts  BOOLEAN DEFAULT TRUE;

-- Comentarios descriptivos
COMMENT ON COLUMN users.privacy_show_online    IS 'Si false, el usuario no emite heartbeat y aparece como desconectado para todos';
COMMENT ON COLUMN users.privacy_show_last_seen IS 'Si false, last_seen_at no se devuelve en GET /users/:id';
COMMENT ON COLUMN users.privacy_read_receipts  IS 'Si false, los mensajes leídos solo se marcan como entregados (no read_at)';
