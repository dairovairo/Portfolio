// Tests unitarios de server/lib/batteryExpiry.js — TTL de 24h de la
// batería social. Correr con:
//
//   node --test server/test/batteryExpiry.test.js
//
// Cubre las tres piezas puras (isBatteryExpired, applyBatteryExpiry,
// applyBatteryExpiryToUsers). Las variantes que van a Supabase
// (expireUserBatteryIfNeeded, expireStaleBatteries) NO se testean aquí
// porque tocan la BD — para eso hace falta integración, no unitario.

const test = require('node:test');
const assert = require('node:assert/strict');

// batteryExpiry.js hace un require top-level de ./supabase, que lanza si
// no encuentra SUPABASE_URL/SUPABASE_SERVICE_KEY. Los ponemos con
// valores dummy antes de importar — las funciones puras que probamos
// aquí (isBatteryExpired, applyBatteryExpiry, applyBatteryExpiryToUsers)
// no tocan el cliente Supabase para nada.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://stub.local';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'stub-key';

const {
  BATTERY_TTL_MS,
  isBatteryExpired,
  applyBatteryExpiry,
  applyBatteryExpiryToUsers,
} = require('../lib/batteryExpiry');

// Fecha fija para todos los tests — punto de referencia estable.
const NOW = new Date('2026-07-01T12:00:00Z').getTime();
const iso = (msOffset) => new Date(NOW + msOffset).toISOString();

// ─── isBatteryExpired ─────────────────────────────────────────────────
test('expiry: sin updated_at es expirada por defecto', () => {
  assert.equal(isBatteryExpired(null, NOW), true);
  assert.equal(isBatteryExpired(undefined, NOW), true);
  assert.equal(isBatteryExpired('', NOW), true);
});

test('expiry: fecha inválida se trata como expirada (defensa)', () => {
  assert.equal(isBatteryExpired('no-es-fecha', NOW), true);
});

test('expiry: acabas de actualizar → no expirada', () => {
  assert.equal(isBatteryExpired(iso(0), NOW), false);
  assert.equal(isBatteryExpired(iso(-1000), NOW), false); // 1s antes
});

test('expiry: justo por debajo del TTL (23h59m) → no expirada', () => {
  const almostExpired = -1 * (BATTERY_TTL_MS - 60_000); // -23h59m
  assert.equal(isBatteryExpired(iso(almostExpired), NOW), false);
});

test('expiry: justo al TTL (24h exactas) → expirada (borde inclusivo)', () => {
  // La comprobación es `>= BATTERY_TTL_MS`: a las 24h exactas ya caduca.
  // Es el borde deliberado — mejor caducar un instante antes que un
  // instante después.
  assert.equal(isBatteryExpired(iso(-BATTERY_TTL_MS), NOW), true);
});

test('expiry: fecha en el futuro → no expirada (no negativa)', () => {
  // Si por reloj desfasado alguien tiene updated_at en el futuro, no
  // debe salir como expirada — el cálculo now-updated sería negativo,
  // y la comparación con TTL falla correctamente.
  assert.equal(isBatteryExpired(iso(60_000), NOW), false);
});

// ─── applyBatteryExpiry ───────────────────────────────────────────────
test('apply: usuario null/undefined pasa tal cual', () => {
  assert.equal(applyBatteryExpiry(null, NOW), null);
  assert.equal(applyBatteryExpiry(undefined, NOW), undefined);
});

test('apply: batería fresca conserva sus datos y añade battery_expired=false', () => {
  const user = {
    id: 'u1',
    battery_level: 78,
    battery_is_estimated: true,
    battery_updated_at: iso(-3_600_000), // hace 1h
  };
  const out = applyBatteryExpiry(user, NOW);
  assert.equal(out.battery_level, 78);
  assert.equal(out.battery_is_estimated, true);
  assert.equal(out.battery_expired, false);
  // No debe mutar el original
  assert.equal(user.battery_expired, undefined);
});

test('apply: batería caducada fuerza level=0, is_estimated=false, expired=true', () => {
  const user = {
    id: 'u1',
    battery_level: 78,
    battery_is_estimated: true,
    battery_updated_at: iso(-BATTERY_TTL_MS - 1_000),
  };
  const out = applyBatteryExpiry(user, NOW);
  assert.equal(out.battery_level, 0);
  assert.equal(out.battery_is_estimated, false);
  assert.equal(out.battery_expired, true);
  // Los otros campos del usuario NO se tocan
  assert.equal(out.id, 'u1');
  // Y no muta el original
  assert.equal(user.battery_level, 78);
});

test('apply: sin battery_updated_at → tratada como expirada', () => {
  const user = { id: 'u1', battery_level: 42 };
  const out = applyBatteryExpiry(user, NOW);
  assert.equal(out.battery_level, 0);
  assert.equal(out.battery_expired, true);
});

// ─── applyBatteryExpiryToUsers ────────────────────────────────────────
test('list: array vacío → array vacío', () => {
  assert.deepEqual(applyBatteryExpiryToUsers([], NOW), []);
});

test('list: null/undefined → array vacío (defensa)', () => {
  assert.deepEqual(applyBatteryExpiryToUsers(null, NOW), []);
  assert.deepEqual(applyBatteryExpiryToUsers(undefined, NOW), []);
});

test('list: mezcla fresca + caducada — cada una recibe su tratamiento', () => {
  const fresh = { id: 'a', battery_level: 60, battery_updated_at: iso(-3_600_000) };
  const stale = { id: 'b', battery_level: 60, battery_updated_at: iso(-2 * BATTERY_TTL_MS) };
  const [outFresh, outStale] = applyBatteryExpiryToUsers([fresh, stale], NOW);
  assert.equal(outFresh.battery_expired, false);
  assert.equal(outFresh.battery_level, 60);
  assert.equal(outStale.battery_expired, true);
  assert.equal(outStale.battery_level, 0);
});
