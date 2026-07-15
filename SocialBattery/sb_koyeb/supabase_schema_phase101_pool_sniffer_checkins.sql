-- ============================================================
-- SocialBattery — Phase 101: Check-ins del modo Sniffer
-- Run this in Supabase SQL Editor
-- ============================================================
-- Botón "Estoy dentro" en el modo Sniffer de una quedada
-- (PoolSnifferPage.jsx). Cuando alguien con acceso a la quedada confirma
-- que está dentro del radio del punto (verificado también en el servidor,
-- no solo en el cliente), se guarda aquí una fila con la hora de llegada.
-- Un usuario solo puede aparecer una vez por quedada (UNIQUE) — la fecha
-- que se guarda es la de su primera confirmación.
--
-- La lista es compartida: todos los que tienen acceso a la quedada
-- (mismo criterio que ver la quedada — canAccessPool en pools.js) pueden
-- ver quién ha llegado y a qué hora.

CREATE TABLE IF NOT EXISTS public.pool_sniffer_checkins (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id       UUID        NOT NULL REFERENCES public.hangout_pools(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  checked_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (pool_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_pool_sniffer_checkins_pool
  ON public.pool_sniffer_checkins(pool_id);

-- ── RLS ────────────────────────────────────────────────────────
-- El backend usa el cliente de servicio (bypassa RLS) para todo el CRUD,
-- igual que el resto de endpoints de quedadas. Esta política de lectura es
-- solo una capa extra de defensa, mismo criterio que otras tablas de
-- fases anteriores (ver event_locator_groups, fase 98).
ALTER TABLE public.pool_sniffer_checkins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pool participants can read sniffer checkins" ON public.pool_sniffer_checkins;
CREATE POLICY "pool participants can read sniffer checkins" ON public.pool_sniffer_checkins
  FOR SELECT USING (
    user_id = auth.uid()
    OR pool_id IN (SELECT id FROM public.hangout_pools WHERE creator_id = auth.uid())
    OR pool_id IN (SELECT pool_id FROM public.pool_participants WHERE user_id = auth.uid())
  );

ALTER PUBLICATION supabase_realtime ADD TABLE public.pool_sniffer_checkins;

NOTIFY pgrst, 'reload schema';
