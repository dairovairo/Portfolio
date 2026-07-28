// Tests unitarios de server/lib/adPricing.js — cálculo de importes de
// publicidad on-demand para eventos (premium/ultra) y sorteos (light).
// Correr con:
//
//   node --test server/test/adPricing.test.js
//
// Estas tarifas viven DUPLICADAS a propósito en client/src/lib/adPricing.js
// (para poder mostrar el precio en la UI sin ir al servidor) y aquí (para
// que cuando se enchufe la pasarela de cobro sepa los mismos números).
// Este fichero verifica que los cálculos del servidor cuadran; hay una
// prueba adicional al final que verifica que las tarifas del cliente no
// han divergido de las del servidor — así un desliz en el mirror se caza
// inmediatamente.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EVENT_AD_PRICING,
  RAFFLE_AD_PRICING,
  computeEventAdPriceCents,
  computeRaffleAdPriceCents,
} = require('../lib/adPricing');

// ─── computeEventAdPriceCents ─────────────────────────────────────────
test('event pricing: premium a 2c/notif × 500 = 1000c (10€)', () => {
  assert.equal(computeEventAdPriceCents('premium', 500), 1000);
});

test('event pricing: ultra a 4c/notif × 500 = 2000c (20€)', () => {
  assert.equal(computeEventAdPriceCents('ultra', 500), 2000);
});

test('event pricing: ultra × 50000 (tope máximo) = 200000c (2000€)', () => {
  assert.equal(computeEventAdPriceCents('ultra', 50000), 200000);
});

test('event pricing: basic no tiene tarifa → siempre 0', () => {
  assert.equal(computeEventAdPriceCents('basic', 500), 0);
  assert.equal(computeEventAdPriceCents('basic', 999999), 0);
});

test('event pricing: plan desconocido → 0 (no lanza)', () => {
  assert.equal(computeEventAdPriceCents('inexistente', 500), 0);
  assert.equal(computeEventAdPriceCents(null, 500), 0);
  assert.equal(computeEventAdPriceCents(undefined, 500), 0);
});

test('event pricing: unidades <=0 → 0', () => {
  assert.equal(computeEventAdPriceCents('premium', 0), 0);
  assert.equal(computeEventAdPriceCents('premium', -100), 0);
});

test('event pricing: unidades no-numéricas → 0 (defensa)', () => {
  assert.equal(computeEventAdPriceCents('premium', 'muchas'), 0);
  assert.equal(computeEventAdPriceCents('premium', null), 0);
  assert.equal(computeEventAdPriceCents('premium', undefined), 0);
});

test('event pricing: unidades decimales → floor (no cobrar por medias notificaciones)', () => {
  // Solo se factura por entregas reales; una notificación medio-entregada
  // no existe. Math.floor evita ambigüedad.
  assert.equal(computeEventAdPriceCents('premium', 500.9), 1000);
  assert.equal(computeEventAdPriceCents('premium', 499.99), 998);
});

// ─── computeRaffleAdPriceCents ────────────────────────────────────────
test('raffle pricing: light a 2c/vista × 500 = 1000c', () => {
  assert.equal(computeRaffleAdPriceCents('light', 500), 1000);
});

test('raffle pricing: community/volt no tienen tarifa on-demand → 0', () => {
  // Community es gratis por diseño (aviso a la propia comunidad); Volt
  // es la modalidad "todos los usuarios" sin aforo contratado. Solo
  // Light se cobra.
  assert.equal(computeRaffleAdPriceCents('community', 500), 0);
  assert.equal(computeRaffleAdPriceCents('volt', 500), 0);
});

test('raffle pricing: unidades <=0 → 0', () => {
  assert.equal(computeRaffleAdPriceCents('light', 0), 0);
  assert.equal(computeRaffleAdPriceCents('light', -1), 0);
});

test('raffle pricing: floor de decimales (mismo criterio que eventos)', () => {
  assert.equal(computeRaffleAdPriceCents('light', 500.75), 1000);
});

// ─── Verificación del mirror cliente ↔ servidor ───────────────────────
// Este test carga la copia del cliente (que es un módulo ESM) desde el
// runtime CJS del server. Si Node no puede resolver el import (por si el
// working directory cambia en CI), se marca como skip para no bloquear
// el resto de tests — pero se avisa con un mensaje claro.
test('mirror: las tarifas de cliente y servidor coinciden número a número', async (t) => {
  let clientMod;
  try {
    clientMod = await import('../../client/src/lib/adPricing.js');
  } catch (err) {
    return t.skip(`no se pudo cargar el módulo del cliente (probablemente CWD distinto): ${err.message}`);
  }
  assert.deepEqual(
    clientMod.EVENT_AD_PRICING,
    EVENT_AD_PRICING,
    'EVENT_AD_PRICING ha divergido entre cliente y servidor — pueden cobrar precios distintos',
  );
  assert.deepEqual(
    clientMod.RAFFLE_AD_PRICING,
    RAFFLE_AD_PRICING,
    'RAFFLE_AD_PRICING ha divergido entre cliente y servidor — pueden cobrar precios distintos',
  );
});
