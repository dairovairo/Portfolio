// ─────────────────────────────────────────────────────────────────────────
// Normaliza la clave privada de una cuenta de servicio de Google tal y como
// llega por variable de entorno.
// ─────────────────────────────────────────────────────────────────────────
// Al pegarla en Railway/Render es fácil que acabe con comillas, con una coma
// final, con los saltos de línea como "\n" literales o convertidos en
// espacios. firebase-admin valida la clave con node-forge, que es muy
// tolerante y la da por buena; pero al firmar usa OpenSSL, que no lo es, y
// cada envío falla con "secretOrPrivateKey must be an asymmetric key when
// using RS256" (el push nativo nunca llegaba por esto). Aquí se reconstruye
// el PEM canónico a partir del base64 que haya dentro.

const crypto = require('crypto');

function normalizePrivateKey(raw) {
  let text = String(raw || '').trim();

  // Pegaron el JSON entero de la cuenta de servicio.
  if (text.startsWith('{')) {
    try { text = JSON.parse(text).private_key || text; } catch {}
  }

  text = text.replace(/\\+r/g, '').replace(/\\+n/g, '\n');

  const match = text.match(/-----BEGIN ((?:RSA )?PRIVATE KEY)-----([\s\S]+?)-----END \1-----/);
  if (!match) return text;

  const [, label, body] = match;
  const base64 = body.replace(/[^A-Za-z0-9+/=]/g, '');
  const lines = base64.match(/.{1,64}/g) || [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

/** ¿Puede OpenSSL usar esta clave para firmar? (lo que forge no comprueba) */
function isUsablePrivateKey(pem) {
  try {
    return crypto.createPrivateKey(pem).asymmetricKeyType === 'rsa';
  } catch {
    return false;
  }
}

module.exports = { normalizePrivateKey, isUsablePrivateKey };
