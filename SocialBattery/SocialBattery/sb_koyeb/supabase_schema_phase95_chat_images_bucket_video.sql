-- ============================================================
-- SocialBattery — Phase 95: Ampliar bucket "chat-images" para vídeo
-- Run this in Supabase SQL Editor
-- ============================================================
-- El bucket "chat-images" se creó originalmente solo para fotos de chat
-- (mensajes de comunidad/grupo/pool, portadas de actualizaciones de
-- eventos). Si al crearlo se le puso una lista de tipos MIME permitidos
-- (allowed_mime_types) restringida a imágenes, o un límite de tamaño
-- (file_size_limit) pequeño, la subida de FOTOS Y VÍDEOS al hilo de
-- comunidad falla silenciosamente contra Supabase Storage antes de que
-- nuestro backend pueda hacer nada.
--
-- Esto quita esa restricción: null en allowed_mime_types = sin
-- restricción de tipo, y sube el límite a 30MB (igual que el multer del
-- hilo, ver server/lib/imageUpload.js → createMediaUpload).

UPDATE storage.buckets
SET
  allowed_mime_types = NULL,
  file_size_limit = 31457280  -- 30 MB, en bytes
WHERE id = 'chat-images';

-- Si el bucket todavía no existe (proyecto nuevo), lo crea público con
-- estos mismos límites en vez de fallar.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
SELECT 'chat-images', 'chat-images', true, 31457280, NULL
WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'chat-images');

-- Verificación rápida: ejecuta esto después para comprobar los valores.
-- SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'chat-images';
