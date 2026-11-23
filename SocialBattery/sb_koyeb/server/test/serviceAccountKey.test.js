const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { normalizePrivateKey, isUsablePrivateKey } = require('../lib/serviceAccountKey');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const pkcs1 = privateKey.export({ type: 'pkcs1', format: 'pem' });

const VARIANTS = {
  'PEM correcto': pem,
  'PKCS#1': pkcs1,
  'CRLF': pem.replace(/\n/g, '\r\n'),
  'saltos como barra-n literal': pem.replace(/\n/g, '\\n'),
  'barra-n con doble escape': pem.replace(/\n/g, '\\\\n'),
  'barra-r barra-n literales': pem.replace(/\n/g, '\\r\\n'),
  'entre comillas': `"${pem.trim()}"`,
  'entre comillas con barra-n literal': `"${pem.replace(/\n/g, '\\n')}"`,
  'con la coma del JSON': `"${pem.replace(/\n/g, '\\n')}",`,
  'saltos convertidos en espacios': pem.replace(/\n/g, ' '),
  'sin saltos': pem.replace(/\n/g, ''),
  'indentado': pem.replace(/\n/g, '\n    '),
  'con el nombre de la variable delante': `private_key: ${pem}`,
  'JSON completo de la cuenta de servicio': JSON.stringify({ project_id: 'p', private_key: pem }),
};

for (const [name, value] of Object.entries(VARIANTS)) {
  test(`normalizePrivateKey: ${name} → firma con RS256`, () => {
    const key = normalizePrivateKey(value);
    assert.ok(isUsablePrivateKey(key));
    const signature = crypto.sign('RSA-SHA256', Buffer.from('hola'), key);
    assert.ok(crypto.verify('RSA-SHA256', Buffer.from('hola'), publicKey, signature));
  });
}

test('normalizePrivateKey: un PEM correcto sale idéntico (no se come "+n"/"+r" del base64)', () => {
  // Varias claves: el base64 de cada una es aleatorio.
  for (let i = 0; i < 8; i += 1) {
    const k = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
    assert.equal(normalizePrivateKey(k), k);
    assert.equal(normalizePrivateKey(k.replace(/\n/g, '\\n')), k);
  }
});

test('isUsablePrivateKey: rechaza vacío, basura y clave truncada', () => {
  assert.equal(isUsablePrivateKey(normalizePrivateKey(undefined)), false);
  assert.equal(isUsablePrivateKey(normalizePrivateKey('no soy una clave')), false);
  assert.equal(isUsablePrivateKey(normalizePrivateKey(pem.slice(0, 600))), false);
});
