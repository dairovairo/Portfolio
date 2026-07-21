-- ══════════════════════════════════════════════════
--  SocialBattery — Fase 119: Likes en sorteos
--  Run this in: Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════
-- Réplica exacta del patrón de community_event_likes (fase 15) aplicado
-- a community_raffles. Necesario para poder ordenar/rankear sorteos por
-- likes en la vista global "Actividades → Sorteos" (CommunityPage) y en
-- el modal de rankings de sorteos.
--
-- Igual que los likes de eventos: PK compuesta (raffle_id, user_id) para
-- imponer que cada usuario dé como mucho un like por sorteo, y borrado
-- en cascada al borrarse el sorteo o el usuario.

CREATE TABLE IF NOT EXISTS public.community_raffle_likes (
  raffle_id  UUID NOT NULL REFERENCES public.community_raffles(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (raffle_id, user_id)
);

-- Para contar "cuántos likes ha dado este usuario" (ranking histórico
-- personal, si algún día se añade) sin escanear toda la tabla.
CREATE INDEX IF NOT EXISTS idx_community_raffle_likes_user
  ON public.community_raffle_likes(user_id);

ALTER TABLE public.community_raffle_likes ENABLE ROW LEVEL SECURITY;

-- Todos los usuarios autenticados pueden leer likes (para contar y saber
-- si ya has dado like). El backend siempre usa el cliente de servicio
-- para los sorteos, pero mantenemos las políticas como defensa por
-- capas — mismo criterio que community_event_likes.
DROP POLICY IF EXISTS "Raffle likes are public" ON public.community_raffle_likes;
CREATE POLICY "Raffle likes are public" ON public.community_raffle_likes
  FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "Users can like raffles" ON public.community_raffle_likes;
CREATE POLICY "Users can like raffles" ON public.community_raffle_likes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can remove own raffle likes" ON public.community_raffle_likes;
CREATE POLICY "Users can remove own raffle likes" ON public.community_raffle_likes
  FOR DELETE USING (auth.uid() = user_id);

NOTIFY pgrst, 'reload schema';
