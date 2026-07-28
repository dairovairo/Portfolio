// Tests unitarios de client/src/lib/currency.js — moneda "Volts" del
// juego, persistida en localStorage por usuario. Correr con:
//
//   node --test client/src/lib/currency.test.js
//
// Cubre saldo inicial, load/save por usuario, y el mecanismo de
// recompensa diaria (una vez al día por usuario, anti-doble reclamo).
//
// localStorage no existe en el runtime de Node, así que instalamos un
// stub en memoria ANTES del import. Reemplazamos su implementación entre
// tests con t.beforeEach → así cada test parte de un almacenamiento
// limpio y no arrastra saldo de test anterior.

import test from 'node:test';
import assert from 'node:assert/strict';

// ─── Stub de localStorage ──────────────────────────────────────────────
// Muy pequeño: solo los tres métodos que usa currency.js.
class MemStorage {
  constructor() { this.data = new Map(); }
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
  clear() { this.data.clear(); }
}

globalThis.localStorage = new MemStorage();

const {
  CURRENCY_SYMBOL,
  CURRENCY_NAME,
  CURRENCY_NAME_PLURAL,
  DAILY_BATTERY_REWARD,
  loadVolts,
  saveVolts,
  hasClaimedDailyBatteryReward,
  claimDailyBatteryReward,
} = await import('./currency.js');

// El saldo inicial no está exportado; lo derivamos del comportamiento
// (carga sin nada guardado) para no acoplarse a la constante.
const STARTING_VOLTS = loadVolts('probe');
// Limpia el probe que acabamos de hacer, para no ensuciar los tests.
globalThis.localStorage.clear();

// Cada test parte de storage limpio.
test.beforeEach(() => globalThis.localStorage.clear());

// ─── Constantes públicas ──────────────────────────────────────────────
test('constantes: nombre y símbolo bien tipados', () => {
  assert.equal(typeof CURRENCY_SYMBOL, 'string');
  assert.ok(CURRENCY_SYMBOL.length > 0);
  assert.equal(CURRENCY_NAME, 'Volt');
  assert.equal(CURRENCY_NAME_PLURAL, 'Volts');
});

test('constantes: recompensa diaria es positiva', () => {
  assert.ok(Number.isFinite(DAILY_BATTERY_REWARD));
  assert.ok(DAILY_BATTERY_REWARD > 0);
});

// ─── loadVolts / saveVolts ────────────────────────────────────────────
test('load: usuario nuevo → saldo inicial', () => {
  assert.equal(loadVolts('u-nuevo'), STARTING_VOLTS);
});

test('load: sin userId → saldo inicial sin tocar storage', () => {
  saveVolts('otro', 999);
  assert.equal(loadVolts(null), STARTING_VOLTS);
  assert.equal(loadVolts(undefined), STARTING_VOLTS);
  assert.equal(loadVolts(''), STARTING_VOLTS);
  // Y el saldo del "otro" usuario intacto:
  assert.equal(loadVolts('otro'), 999);
});

test('save + load: round-trip preserva el valor exacto', () => {
  saveVolts('u1', 1234);
  assert.equal(loadVolts('u1'), 1234);
});

test('save: sin userId → no persiste nada', () => {
  saveVolts(null, 500);
  assert.equal(loadVolts(null), STARTING_VOLTS);
});

test('load: valor corrupto en storage → fallback a saldo inicial', () => {
  // Simulamos un valor no numérico entrando "a mano" en el storage —
  // podría pasar por una corrupción antigua o si el usuario editó algo.
  globalThis.localStorage.setItem('sb-shop-coins_u1', 'no-es-un-número');
  assert.equal(loadVolts('u1'), STARTING_VOLTS);
});

test('load: 0 es un saldo válido (no cae al fallback)', () => {
  // Un usuario que se gasta todos sus Volts DEBE ver 0, no que se le
  // regeneren.
  saveVolts('u1', 0);
  assert.equal(loadVolts('u1'), 0);
});

test('save/load: aislamiento por usuario — cada uno tiene el suyo', () => {
  saveVolts('a', 10);
  saveVolts('b', 200);
  saveVolts('c', 3000);
  assert.equal(loadVolts('a'), 10);
  assert.equal(loadVolts('b'), 200);
  assert.equal(loadVolts('c'), 3000);
});

// ─── Recompensa diaria ────────────────────────────────────────────────
test('daily: usuario recién creado no ha reclamado hoy', () => {
  assert.equal(hasClaimedDailyBatteryReward('u1'), false);
});

test('daily: sin userId → false, sin tocar nada', () => {
  assert.equal(hasClaimedDailyBatteryReward(null), false);
  assert.equal(hasClaimedDailyBatteryReward(undefined), false);
});

test('daily: reclamar suma DAILY_BATTERY_REWARD al saldo', () => {
  saveVolts('u1', 100);
  const before = loadVolts('u1');
  const result = claimDailyBatteryReward('u1');
  assert.equal(result.claimed, true);
  assert.equal(result.volts, before + DAILY_BATTERY_REWARD);
  assert.equal(loadVolts('u1'), before + DAILY_BATTERY_REWARD);
});

test('daily: reclamar dos veces el mismo día → segunda vez es no-op', () => {
  saveVolts('u1', 100);
  claimDailyBatteryReward('u1');
  const afterFirst = loadVolts('u1');
  const second = claimDailyBatteryReward('u1');
  assert.equal(second.claimed, false);
  assert.equal(second.volts, afterFirst); // saldo intacto
  assert.equal(loadVolts('u1'), afterFirst);
});

test('daily: tras reclamar, hasClaimed devuelve true', () => {
  claimDailyBatteryReward('u1');
  assert.equal(hasClaimedDailyBatteryReward('u1'), true);
});

test('daily: sin userId → no reclama, devuelve saldo actual', () => {
  const r = claimDailyBatteryReward(null);
  assert.equal(r.claimed, false);
  assert.equal(r.volts, STARTING_VOLTS);
});

test('daily: reclamos son independientes entre usuarios', () => {
  saveVolts('a', 100);
  saveVolts('b', 100);
  const ra = claimDailyBatteryReward('a');
  assert.equal(ra.claimed, true);
  // 'b' no ha reclamado todavía, así que su primer reclamo también sirve
  const rb = claimDailyBatteryReward('b');
  assert.equal(rb.claimed, true);
  // 'a' reclama de nuevo el mismo día → bloqueado
  const raAgain = claimDailyBatteryReward('a');
  assert.equal(raAgain.claimed, false);
  // 'b' también bloqueado en su segundo intento
  const rbAgain = claimDailyBatteryReward('b');
  assert.equal(rbAgain.claimed, false);
});

test('daily: reclamo respeta al día "de mentira" — se puede resetear borrando la marca', () => {
  // Regresión: si el usuario cambia de día (medianoche real) o si alguien
  // borra manualmente su claim (soporte), el siguiente reclamo debe
  // volver a funcionar. Aquí simulamos esto último.
  claimDailyBatteryReward('u1');
  assert.equal(hasClaimedDailyBatteryReward('u1'), true);
  // "Es un nuevo día":
  globalThis.localStorage.removeItem('sb-daily-volts-claim_u1');
  assert.equal(hasClaimedDailyBatteryReward('u1'), false);
  const r = claimDailyBatteryReward('u1');
  assert.equal(r.claimed, true);
});
