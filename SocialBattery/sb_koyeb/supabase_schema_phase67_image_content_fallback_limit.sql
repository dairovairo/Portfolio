-- ============================================================
-- SocialBattery — Phase 67: Alinear el límite de content con el fallback
-- de base64 real (no con un número arbitrario)
-- Run this in Supabase SQL Editor
-- ============================================================
-- Bug: al enviar una foto en un chat (quedada o grupo), si la subida al
-- bucket 'chat-images' falla por el motivo que sea, storeImage() cae a un
-- fallback que guarda la imagen como data URL en base64 directamente en
-- `content`. Ese fallback solo lanza su propio error si supera
-- fallbackMaxLength (8.000.000 caracteres, ver storeImage() en
-- server/lib/imageUpload.js) — pero el CHECK de la tabla en base de datos
-- seguía puesto en 10000 (Phase 22 / Phase 66), muy por debajo de eso.
-- Resultado: cualquier foto real que cayera en el fallback de base64
-- pasaba el check de la aplicación pero rompía el INSERT en Postgres.
--
-- Fix: subir el CHECK de content al mismo tope que ya usa storeImage()
-- como fallbackMaxLength, para que los dos límites sean consistentes y
-- esto no pueda volver a pasar mientras el fallback exista.
--
-- Nota: esto NO soluciona por qué la subida al bucket falla en primer
-- lugar (revisa los logs del servidor — ahora storeImage() imprime el
-- error real de Supabase Storage con el prefijo "[storeImage]"). Esto
-- solo evita que ese fallo se traduzca en un error 500 al usuario.

ALTER TABLE public.pool_messages DROP CONSTRAINT IF EXISTS pool_messages_content_check;
ALTER TABLE public.pool_messages ADD CONSTRAINT pool_messages_content_check
  CHECK (char_length(content) BETWEEN 1 AND 8000000);

ALTER TABLE public.group_messages DROP CONSTRAINT IF EXISTS group_messages_content_check;
ALTER TABLE public.group_messages ADD CONSTRAINT group_messages_content_check
  CHECK (char_length(content) BETWEEN 1 AND 8000000);
