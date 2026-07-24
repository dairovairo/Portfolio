-- ============================================================
-- SocialBattery — Phase 128: RLS para conversation_pins
-- Run this in Supabase SQL Editor
-- ============================================================
-- La tabla conversation_pins (fase 77) se creó sin ENABLE ROW LEVEL
-- SECURITY ni políticas — el único hueco de RLS entre las ~48 tablas del
-- esquema. Como el cliente además suscribe realtime a esa tabla (ver
-- client/src/pages/MessagesPage.jsx: table: 'conversation_pins'), con la
-- anon key cualquier usuario autenticado podía leer y escuchar los pins de
-- CUALQUIER chat 1:1 de la app, no solo los suyos.
--
-- Todas las escrituras reales pasan por el servidor (routes/messages.js)
-- usando la service key, que se salta RLS, así que estas políticas no
-- rompen ningún flujo existente. Solo cierran la puerta trasera del
-- cliente.
--
-- Modelo de acceso: un pin pertenece a una friendship (1:1). Solo los dos
-- participantes de esa amistad pueden verlo o tocarlo.

ALTER TABLE public.conversation_pins ENABLE ROW LEVEL SECURITY;

-- SELECT: solo los dos participantes de la amistad.
DROP POLICY IF EXISTS "Friendship participants can read pin" ON public.conversation_pins;
CREATE POLICY "Friendship participants can read pin" ON public.conversation_pins FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.friendships f
      WHERE f.id = friendship_id
        AND (f.requester_id = auth.uid() OR f.addressee_id = auth.uid())
    )
  );

-- INSERT: solo los participantes, y marcándose a sí mismos como pinned_by.
DROP POLICY IF EXISTS "Friendship participants can create pin" ON public.conversation_pins;
CREATE POLICY "Friendship participants can create pin" ON public.conversation_pins FOR INSERT
  WITH CHECK (
    auth.uid() = pinned_by
    AND EXISTS (
      SELECT 1 FROM public.friendships f
      WHERE f.id = friendship_id
        AND (f.requester_id = auth.uid() OR f.addressee_id = auth.uid())
    )
  );

-- UPDATE: cualquiera de los dos participantes puede sustituir el pin
-- (upsert desde el servidor pasa por aquí si ya existía la fila).
DROP POLICY IF EXISTS "Friendship participants can update pin" ON public.conversation_pins;
CREATE POLICY "Friendship participants can update pin" ON public.conversation_pins FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.friendships f
      WHERE f.id = friendship_id
        AND (f.requester_id = auth.uid() OR f.addressee_id = auth.uid())
    )
  )
  WITH CHECK (
    auth.uid() = pinned_by
    AND EXISTS (
      SELECT 1 FROM public.friendships f
      WHERE f.id = friendship_id
        AND (f.requester_id = auth.uid() OR f.addressee_id = auth.uid())
    )
  );

-- DELETE: cualquiera de los dos participantes.
DROP POLICY IF EXISTS "Friendship participants can delete pin" ON public.conversation_pins;
CREATE POLICY "Friendship participants can delete pin" ON public.conversation_pins FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.friendships f
      WHERE f.id = friendship_id
        AND (f.requester_id = auth.uid() OR f.addressee_id = auth.uid())
    )
  );
