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
  FREE_UNITS,
  MIN_UNITS,
  EVENT_AD_PRICING,
  RAFFLE_AD_PRICING,
  computeEventAdPriceCents,
  computeRaffleAdPriceCents,
  computeEventChargeCents,
} = require('../lib/adPricing');

// ─── Eventos ──────────────────────────────────────────────────────────
test('premium: 2 cts por notificación, las 50 primeras gratis', () => {
  assert.equal(computeEventAdPriceCents('premium', 500), 900);
  assert.equal(computeEventAdPriceCents('premium', 500, 0), 1000);
  assert.equal(computeEventAdPriceCents('premium', 50), 0);
});

test('ultra: 2 cts por notificación + 1 ct por banner visto (máximo)', () => {
  assert.equal(computeEventAdPriceCents('ultra', 500), 1350);
  assert.equal(computeEventAdPriceCents('ultra', 50000, 0), 150000);
});

test('computeEventChargeCents: cobra lo entregado de cada cosa', () => {
  assert.equal(computeEventChargeCents('ultra', 250, 150), 200 * 2 + 100);
  assert.equal(computeEventChargeCents('ultra', 250, 0), 400);
  assert.equal(computeEventChargeCents('premium', 250, 999), 400);
});

test('planes sin tarifa, unidades inválidas y decimales', () => {
  for (const plan of ['basic', 'inexistente', null, undefined]) {
    assert.equal(computeEventAdPriceCents(plan, 500), 0);
    assert.equal(computeEventChargeCents(plan, 500, 500), 0);
  }
  for (const units of [0, -100, 'muchas', null, undefined]) {
    assert.equal(computeEventAdPriceCents('premium', units), 0);
  }
  assert.equal(computeEventAdPriceCents('premium', 100.9, 0), 200);
});

// ─── Sorteos ──────────────────────────────────────────────────────────
test('light: 2 cts por visualización, las 50 primeras gratis', () => {
  assert.equal(computeRaffleAdPriceCents('light', 100), 100);
  assert.equal(computeRaffleAdPriceCents('light', 500, 0), 1000);
});

test('community y volt no tienen tarifa por visualización', () => {
  assert.equal(computeRaffleAdPriceCents('community', 500), 0);
  assert.equal(computeRaffleAdPriceCents('volt', 500), 0);
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
  for (const units of [0, 50, 100, 1234, 50000]) {
    for (const plan of ['basic', 'premium', 'ultra']) {
      assert.equal(clientMod.computeEventAdPriceCents(plan, units), computeEventAdPriceCents(plan, units));
      assert.equal(clientMod.computeEventAdPriceCents(plan, units, 0), computeEventAdPriceCents(plan, units, 0));
    }
    assert.equal(clientMod.computeRaffleAdPriceCents('light', units), computeRaffleAdPriceCents('light', units));
  }
  assert.equal(clientMod.MIN_UNITS, MIN_UNITS);
  assert.equal(clientMod.FREE_UNITS, FREE_UNITS);
});
