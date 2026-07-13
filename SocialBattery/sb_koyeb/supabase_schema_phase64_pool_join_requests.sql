-- ============================================================
-- SocialBattery — Phase 64: Solicitudes de invitación a quedadas privadas
-- Run this in Supabase SQL Editor
-- ============================================================
-- Permite, en una quedada privada:
--   - Al creador: invitar directamente a amigos (usa pool_invitees, ya
--     existente) y ver/gestionar las solicitudes de invitación propuestas
--     por los miembros de la quedada.
--   - A cualquier miembro (no creador): proponer/solicitar que se invite
--     a un amigo suyo, quedando pendiente de aprobación del creador.

CREATE TABLE IF NOT EXISTS pool_join_requests (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pool_id           UUID NOT NULL REFERENCES hangout_pools(id) ON DELETE CASCADE,
  requested_user_id UUID NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  requested_by      UUID NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (pool_id, requested_user_id)
);

CREATE INDEX IF NOT EXISTS idx_pool_join_requests_pool   ON pool_join_requests(pool_id);
CREATE INDEX IF NOT EXISTS idx_pool_join_requests_user   ON pool_join_requests(requested_user_id);
CREATE INDEX IF NOT EXISTS idx_pool_join_requests_by     ON pool_join_requests(requested_by);

-- RLS: service role handles everything through la API
ALTER TABLE pool_join_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pool_join_requests_all" ON pool_join_requests FOR ALL USING (true) WITH CHECK (true);
