-- ============================================================
-- SocialBattery — Phase 103: Reparto de banners voladores (Sorteo Light)
-- Run this in Supabase SQL Editor
-- ============================================================
-- El sorteo Light incluye "Apariciones de banner esporádico al número de
-- usuarios contratado" (banner_views_contracted, fase 102). Esta tabla
-- guarda a QUÉ usuarios en concreto se les va a mostrar el banner volador
-- (avioneta con pancarta "¡Sorteo nuevo!") en el menú principal: se elige
-- una selección aleatoria de tamaño banner_views_contracted en el momento
-- de crear el sorteo, y cada usuario objetivo lo ve como máximo una vez
-- (se marca shown_at al mostrarse — ver GET /api/community/raffle-banner).

CREATE TABLE IF NOT EXISTS public.raffle_banner_targets (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  raffle_id  UUID        NOT NULL REFERENCES public.community_raffles(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  shown_at   TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (raffle_id, user_id)
);

-- Índice para la consulta habitual: "¿tiene este usuario algún banner
-- pendiente de mostrar?" (shown_at IS NULL).
CREATE INDEX IF NOT EXISTS idx_raffle_banner_targets_pending
  ON public.raffle_banner_targets(user_id)
  WHERE shown_at IS NULL;

-- El backend usa el cliente de servicio (bypassa RLS) para asignar y leer,
-- igual que el resto de tablas de sorteos/comunidad. Esta política es solo
-- una capa extra de defensa.
ALTER TABLE public.raffle_banner_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users can read own banner targets" ON public.raffle_banner_targets;
CREATE POLICY "users can read own banner targets" ON public.raffle_banner_targets
  FOR SELECT USING (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
