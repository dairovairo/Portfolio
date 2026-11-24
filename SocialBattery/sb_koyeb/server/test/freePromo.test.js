// Tests del tope de promociones gratis (pagos apagados).
// Correr con: node --test server/test/freePromo.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

let rpcError = null;
function mock(path, exports) {
  const id = require.resolve(path);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
mock('../lib/supabase', { rpc: async () => ({ data: null, error: rpcError }) });

const freePromo = require('../lib/freePromo');

const DAY = 24 * 3600 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();

test.afterEach(() => { rpcError = null; delete process.env.PAYMENTS_ENABLED; });

test('nextSlotAt: libre hasta gastar el cupo y ventana móvil de 30 días', () => {
  assert.equal(freePromo.nextSlotAt([ago(1), ago(2), ago(3)]), null);
  assert.equal(freePromo.nextSlotAt([ago(1), ago(2), ago(3), ago(31)]), null);
  const next = new Date(freePromo.nextSlotAt([ago(1), ago(2), ago(3), ago(20)])).getTime();
  assert.ok(Math.abs(next - (Date.now() + 10 * DAY)) < 60000);
});

test('capUnits: recorta solo con los pagos apagados', () => {
  assert.equal(freePromo.capUnits(50000), freePromo.MAX_UNITS);
  assert.equal(freePromo.capUnits(100), 100);
  process.env.PAYMENTS_ENABLED = 'true';
  assert.equal(freePromo.capUnits(50000), 50000);
});

test('reserve: traduce el tope de la base de datos y no esconde otros errores', async () => {
  const launch = () => freePromo.reserve({ userId: 'u', targetId: 't', hold: { kind: 'event', units: 100 } });
  assert.equal(await launch(), null);
  rpcError = { message: 'FREE_PROMO_LIMIT:active' };
  await assert.rejects(launch, { code: 'FREE_PROMO_LIMIT', reason: 'active', status: 429 });
  rpcError = { message: 'FREE_PROMO_LIMIT:month' };
  await assert.rejects(launch, { reason: 'month' });
  rpcError = { message: 'otra cosa' };
  await assert.rejects(launch, { message: 'otra cosa' });
});
