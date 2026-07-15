-- ============================================================
-- SocialBattery — Phase 81: Colaboración económica en comunidades
-- Run this in Supabase SQL Editor
-- ============================================================
-- El admin de la comunidad decide, al crearla, un importe de
-- colaboración (>= 0,99 €, guardado en céntimos). Cualquier miembro
-- que NO sea admin puede "colaborar" una vez por comunidad.
--
-- NOTA (fase actual, sin pasarela de pago real): este endpoint todavía
-- no cobra dinero de verdad, solo registra la intención/colaboración
-- del usuario junto con el importe fijado por el admin. Cuando se
-- integre un cobro real (Stripe Connect, link externo, etc.), esta
-- tabla es el punto de enganche para marcar el pago como completado.

-- Importe de colaboración configurado por el admin (NULL = comunidad
-- sin colaboraciones habilitadas). Se guarda en céntimos de euro.
ALTER TABLE public.communities
  ADD COLUMN IF NOT EXISTS collab_amount_cents INTEGER
    CHECK (collab_amount_cents IS NULL OR collab_amount_cents >= 99);

CREATE TABLE IF NOT EXISTS public.community_collaborations (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID        NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  amount_cents INTEGER     NOT NULL CHECK (amount_cents >= 99),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (community_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_community_collaborations_community
  ON public.community_collaborations(community_id, created_at DESC);

-- ── RLS ────────────────────────────────────────────────────────
-- El backend usa el cliente de servicio (bypassa RLS) para crear y
-- listar, igual que el resto de endpoints de comunidad. Esta política
-- es solo una capa extra de defensa por si algún día se lee esta
-- tabla con el cliente del propio usuario.
ALTER TABLE public.community_collaborations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own collaborations are readable" ON public.community_collaborations;
CREATE POLICY "own collaborations are readable" ON public.community_collaborations
  FOR SELECT USING (
    user_id = auth.uid()
    OR community_id IN (
      SELECT id FROM public.communities WHERE creator_id = auth.uid()
    )
  );

NOTIFY pgrst, 'reload schema';
