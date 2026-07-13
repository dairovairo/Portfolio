-- ============================================================
-- SocialBattery — Phase 60: Foto de portada para quedadas (pools)
-- Run this in Supabase SQL Editor
-- ============================================================
-- Añade una portada opcional a cada hangout_pool, mismo patrón que
-- community_events.cover_image_url (Phase 17). Se sube junto con el resto
-- del formulario de "Crear plan" y se muestra como banner en la tarjeta
-- de la quedada, en el sheet de participantes y en el detalle.

ALTER TABLE public.hangout_pools
  ADD COLUMN IF NOT EXISTS cover_image_url TEXT;
