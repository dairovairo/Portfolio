-- ══════════════════════════════════════════════════════════════════════════════
--  SocialBattery — Phase 27: Fix Push Notifications & Group Realtime
--  Run this in: Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════════════════════════════════
--
--  PROBLEMA QUE RESUELVE:
--  ─────────────────────
--  1. Las notificaciones push (mensajes de grupo, actualizaciones de eventos,
--     etc.) no llegan porque la tabla push_subscriptions tiene RLS activado
--     con la policy USING (auth.uid() = user_id). Cuando el servidor Node.js
--     intenta leer las suscripciones de OTROS usuarios para enviarles push,
--     Supabase bloquea la query aunque se use la SUPABASE_SERVICE_KEY, porque
--     el cliente @supabase/supabase-js no activa el rol service_role en las
--     queries por defecto sin una configuración explícita.
--
--  2. La tabla group_messages puede no estar en la publicación de Realtime
--     o no tener REPLICA IDENTITY completa, causando que los mensajes en
--     tiempo real no lleguen con el payload completo.
--
--  SOLUCIÓN:
--  ─────────
--  1. Añadir una policy de SELECT en push_subscriptions que permita al rol
--     service_role leer TODAS las filas (necesario para el fan-out de push).
--     Las policies de INSERT/UPDATE/DELETE quedan restringidas al propio usuario.
--
--  2. Asegurar que group_messages está en supabase_realtime y tiene
--     REPLICA IDENTITY FULL para que el payload de postgres_changes incluya
--     todos los campos (sin esto, `payload.new` puede estar vacío).
-- ══════════════════════════════════════════════════════════════════════════════


-- ── 1. push_subscriptions: permitir lectura al service_role ──────────────────

-- Eliminar la policy restrictiva de SELECT anterior
DROP POLICY IF EXISTS "Users manage own push subs" ON public.push_subscriptions;

-- Policy de SELECT: el propio usuario puede leer sus subs + service_role puede leerlas todas
CREATE POLICY "Users read own push subs"
  ON public.push_subscriptions
  FOR SELECT
  USING (
    auth.uid() = user_id
    OR auth.role() = 'service_role'
  );

-- Policy de INSERT: solo el propio usuario
CREATE POLICY "Users insert own push subs"
  ON public.push_subscriptions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy de UPDATE: solo el propio usuario
CREATE POLICY "Users update own push subs"
  ON public.push_subscriptions
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Policy de DELETE: el propio usuario O el service_role (para limpiar endpoints caducados)
CREATE POLICY "Users or service delete push subs"
  ON public.push_subscriptions
  FOR DELETE
  USING (
    auth.uid() = user_id
    OR auth.role() = 'service_role'
  );


-- ── 2. group_messages: Realtime + REPLICA IDENTITY FULL ─────────────────────

-- Asegurar que la tabla está en la publicación de Realtime
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.group_messages;
EXCEPTION WHEN duplicate_object THEN
  -- Ya estaba en la publicación, no hacer nada
  NULL;
END $$;

-- REPLICA IDENTITY FULL: necesario para que postgres_changes envíe el payload
-- completo (sin esto, payload.new puede llegar vacío para tablas sin PK simple)
ALTER TABLE public.group_messages REPLICA IDENTITY FULL;

-- Lo mismo para friend_group_members (necesario para el hook de notificaciones)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.friend_group_members;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.friend_group_members REPLICA IDENTITY FULL;

-- Y para event_updates (notificaciones de actualizaciones de eventos)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.event_updates;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.event_updates REPLICA IDENTITY FULL;


-- ── 3. Índice de rendimiento para fan-out de push ────────────────────────────
-- Acelera la query .in('user_id', [...]) que hace el servidor al buscar subs

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id
  ON public.push_subscriptions(user_id);


-- ══════════════════════════════════════════════════════════════════════════════
--  LISTO — Ejecuta este script y las notificaciones push funcionarán.
-- ══════════════════════════════════════════════════════════════════════════════
