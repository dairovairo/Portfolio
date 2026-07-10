-- ============================================================
-- SocialBattery — Phase 66: Fix image uploads in pool chat (quedadas)
-- Run this in Supabase SQL Editor
-- ============================================================
-- Bug: al enviar una foto en el chat de una quedada, la inserción en
-- pool_messages fallaba con un error de la base de datos.
--
-- Causa: pool_messages.content se creó en la Phase 59 con el mismo límite
-- por defecto que tenía group_messages ANTES de la Phase 22
-- (CHECK char_length(content) BETWEEN 1 AND 2000). La Phase 22 amplió
-- ese límite a 10000 caracteres específicamente para que quepan las
-- imágenes (storeImage() guarda ahí la URL pública de Supabase Storage, o
-- si la subida al bucket 'chat-images' falla, una data URL en base64 como
-- respaldo — y esa data URL de una foto real supera los 2000 caracteres
-- casi siempre). Como pool_messages se creó DESPUÉS de la Phase 22 pero
-- nunca recibió ese mismo fix, cualquier imagen que cayera en el respaldo
-- de base64 (o cuya URL fuera algo más larga de lo habitual) violaba el
-- CHECK y la petición devolvía un error 500 al intentar subir la foto.
--
-- Fix: mismo límite que ya tiene group_messages desde la Phase 22.

ALTER TABLE public.pool_messages DROP CONSTRAINT IF EXISTS pool_messages_content_check;
ALTER TABLE public.pool_messages ADD CONSTRAINT pool_messages_content_check
  CHECK (char_length(content) BETWEEN 1 AND 10000);
