const multer = require('multer');
const path = require('path');
const supabase = require('./supabase');

const ALLOWED_IMAGE_RE = /jpeg|jpg|png|webp|gif/;

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
//
// A diferencia de createImageUpload, aquí NO exigimos que el nombre del
// archivo tenga una extensión conocida: las fotos/vídeos capturados desde
// la cámara del móvil llegan a menudo sin extensión reconocible (p.ej.
// "blob", "IMG_1234.HEIC", grabaciones sin extensión) aunque el tipo MIME
// sea perfectamente válido — exigir también la extensión rechazaba esos
// archivos y era la causa del error al subir foto o vídeo. El MIME type
// que pone el propio navegador/SO es la señal fiable.
function createMediaUpload({ maxSizeMb = 30 } = {}) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxSizeMb * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const mimeOk = file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/');
      cb(mimeOk ? null : new Error('Solo se permiten fotos o vídeos'), mimeOk);
    },
  });
}

function extFromMimetype(mimetype = '') {
  const subtype = (mimetype.split('/')[1] || '').split(';')[0];
  const KNOWN_EXT = {
    jpeg: '.jpg', png: '.png', webp: '.webp', gif: '.gif', heic: '.heic', heif: '.heif',
    mp4: '.mp4', quicktime: '.mov', webm: '.webm', 'x-m4v': '.m4v', '3gpp': '.3gp',
  };
  if (KNOWN_EXT[subtype]) return KNOWN_EXT[subtype];
  if (subtype) return `.${subtype}`;
  return mimetype.startsWith('video/') ? '.mp4' : '.jpg';
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

  const ext = path.extname(file.originalname || '').toLowerCase() || extFromMimetype(file.mimetype);
  const fileName = `${objectName}${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(fileName, file.buffer, {
      contentType: file.mimetype,
      upsert: true,
    });

  if (uploadError) {
    console.error(`[storeMedia] Fallo al subir a bucket "${bucket}" (${fileName}):`, uploadError.message || uploadError);
    // Propagamos el motivo real (p.ej. "mime type not supported" si el bucket
    // de Supabase tiene restringidos los tipos permitidos, o "The object
    // exceeded the maximum allowed size" si el límite del bucket es menor
    // que maxSizeMb) — un mensaje genérico aquí hace imposible saber por qué
    // falla la subida de fotos/vídeos en el hilo.
    const err = new Error(uploadError.message ? `No se pudo subir el archivo: ${uploadError.message}` : 'No se pudo subir el archivo. Inténtalo de nuevo.');
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
