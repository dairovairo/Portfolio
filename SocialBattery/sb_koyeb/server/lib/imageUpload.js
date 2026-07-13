const multer = require('multer');
const path = require('path');
const supabase = require('./supabase');

const ALLOWED_IMAGE_RE = /jpeg|jpg|png|webp|gif/;
const ALLOWED_VIDEO_RE = /mp4|mov|webm|m4v|quicktime/;
const ALLOWED_MEDIA_RE = /jpeg|jpg|png|webp|gif|mp4|mov|webm|m4v|quicktime/;

function createImageUpload({ maxSizeMb = 3 } = {}) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxSizeMb * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const extOk = ALLOWED_IMAGE_RE.test(path.extname(file.originalname).toLowerCase());
      const mimeOk = ALLOWED_IMAGE_RE.test(file.mimetype);
      cb(extOk && mimeOk ? null : new Error('Solo se permiten archivos de imagen'), extOk && mimeOk);
    },
  });
}

// Igual que createImageUpload pero también admite vídeo — usado para el
// hilo de comunidad (fotos, vídeos o mensajes de texto).
function createMediaUpload({ maxSizeMb = 30 } = {}) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxSizeMb * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const extOk = ALLOWED_MEDIA_RE.test(path.extname(file.originalname).toLowerCase());
      const mimeOk = ALLOWED_MEDIA_RE.test(file.mimetype) || file.mimetype.startsWith('video/') || file.mimetype.startsWith('image/');
      cb(extOk && mimeOk ? null : new Error('Solo se permiten fotos o vídeos'), extOk && mimeOk);
    },
  });
}

function mediaKindFromMimetype(mimetype = '') {
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('image/')) return 'photo';
  return null;
}

async function storeImage({
  file,
  bucket = 'avatars',
  objectName,
  fallbackMaxLength = 100000,
}) {
  if (!file) {
    const err = new Error('No file provided');
    err.status = 400;
    throw err;
  }

  const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
  const fileName = `${objectName}${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(fileName, file.buffer, {
      contentType: file.mimetype,
      upsert: true,
    });

  if (!uploadError) {
    const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(fileName);
    return publicUrl;
  }

  // No silenciamos el motivo real del fallo de subida — sin esto es
  // imposible saber por qué cae al fallback de base64 (bucket inexistente,
  // políticas, tipo MIME no permitido en el bucket, etc.)
  console.error(`[storeImage] Fallo al subir a bucket "${bucket}" (${fileName}):`, uploadError.message || uploadError);

  const base64 = file.buffer.toString('base64');
  const dataUrl = `data:${file.mimetype};base64,${base64}`;
  if (dataUrl.length > fallbackMaxLength) {
    const err = new Error('La imagen es demasiado grande para guardarla');
    err.status = 413;
    throw err;
  }

  return dataUrl;
}

// Como storeImage, pero pensado para archivos que pueden ser grandes
// (vídeos): si falla la subida al bucket, NO cae a base64 (inviable para
// vídeo, y peligroso para fotos grandes) — simplemente lanza el error.
async function storeMedia({
  file,
  bucket = 'chat-images',
  objectName,
}) {
  if (!file) {
    const err = new Error('No file provided');
    err.status = 400;
    throw err;
  }

  const ext = path.extname(file.originalname).toLowerCase() || (file.mimetype.startsWith('video/') ? '.mp4' : '.jpg');
  const fileName = `${objectName}${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(fileName, file.buffer, {
      contentType: file.mimetype,
      upsert: true,
    });

  if (uploadError) {
    console.error(`[storeMedia] Fallo al subir a bucket "${bucket}" (${fileName}):`, uploadError.message || uploadError);
    const err = new Error('No se pudo subir el archivo. Inténtalo de nuevo.');
    err.status = 502;
    throw err;
  }

  const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(fileName);
  return publicUrl;
}

module.exports = {
  createImageUpload,
  createMediaUpload,
  mediaKindFromMimetype,
  storeImage,
  storeMedia,
};
