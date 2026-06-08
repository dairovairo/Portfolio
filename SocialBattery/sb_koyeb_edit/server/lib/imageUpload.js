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

  const base64 = file.buffer.toString('base64');
  const dataUrl = `data:${file.mimetype};base64,${base64}`;
  if (dataUrl.length > fallbackMaxLength) {
    const err = new Error('La imagen es demasiado grande para guardarla');
    err.status = 413;
    throw err;
  }

  return dataUrl;
}

module.exports = {
  createImageUpload,
  storeImage,
};
