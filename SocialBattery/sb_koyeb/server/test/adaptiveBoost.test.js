// Test unitario de lib/adaptiveBoost.js — usa el test runner nativo de
// Node (node:test), sin dependencias nuevas. Se ejecuta con:
//
//   node --test server/test/adaptiveBoost.test.js
//
// Justificación: es la primera pieza de lógica de scheduling (grupo
// "necesitado" anti-inanición, compartido entre eventPromoPacing.js y
// community.js) que se toca a mano en cada ajuste fino sin ninguna
// verificación automática. Este archivo cubre al menos los casos límite
// que discutimos en la conversación (n=0, n<3, n=3, n grande) para que un
// cambio futuro de la fórmula no rompa el comportamiento en silencio.

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeAdaptiveBoostCount, BOOST_GROUP_SIZE } = require('../lib/adaptiveBoost');

test('BOOST_GROUP_SIZE es 3', () => {
  assert.equal(BOOST_GROUP_SIZE, 3);
});

test('n <= 0 o no numérico devuelve 0 (sin activos, no hay grupo)', () => {
  assert.equal(computeAdaptiveBoostCount(0), 0);
  assert.equal(computeAdaptiveBoostCount(-5), 0);
  assert.equal(computeAdaptiveBoostCount(NaN), 0);
  assert.equal(computeAdaptiveBoostCount(undefined), 0);
});

test('n < BOOST_GROUP_SIZE devuelve n (no puede haber grupo de 3 con menos de 3 activos)', () => {
  assert.equal(computeAdaptiveBoostCount(1), 1);
  assert.equal(computeAdaptiveBoostCount(2), 2);
});

test('n === BOOST_GROUP_SIZE devuelve exactamente 3', () => {
  assert.equal(computeAdaptiveBoostCount(3), 3);
});

test('n > BOOST_GROUP_SIZE siempre se acota a 3, sin importar cuán grande sea n', () => {
  assert.equal(computeAdaptiveBoostCount(4), 3);
  assert.equal(computeAdaptiveBoostCount(10), 3);
  assert.equal(computeAdaptiveBoostCount(500), 3);
  assert.equal(computeAdaptiveBoostCount(100000), 3);
});
