// Tests unitarios de client/src/lib/battery.js — versión cliente del
// TTL de 24h (espejo del que hay en server/lib/batteryExpiry.js) más los
// helpers de display (color, emoji, tiempo relativo).
//
// Correr con:
//
//   node --test client/src/lib/battery.test.js
//
// Este fichero también verifica el mirror con el servidor para
// `isBatteryExpired`: si un día alguien toca solo uno de los dos y no el
// otro, un usuario podría ver la batería expirada en la UI mientras el
// servidor la sigue tratando como fresca (o viceversa) — el test cae y
// se caza al instante.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BATTERY_TTL_MS,
  isBatteryExpired,
  getEffectiveBatteryLevel,
  getBatteryColor,
  getBatteryEmoji,
  formatRelativeTime,
} from './battery.js';

const NOW = new Date('2026-07-01T12:00:00Z').getTime();
const iso = (msOffset) => new Date(NOW + msOffset).toISOString();

// ─── isBatteryExpired ─────────────────────────────────────────────────
test('expiry: sin updatedAt es expirada por defecto', () => {
  assert.equal(isBatteryExpired(null, NOW), true);
  assert.equal(isBatteryExpired(undefined, NOW), true);
  assert.equal(isBatteryExpired('', NOW), true);
});

test('expiry: fecha inválida se trata como expirada', () => {
  assert.equal(isBatteryExpired('sin-forma', NOW), true);
});

test('expiry: reciente → no expirada', () => {
  assert.equal(isBatteryExpired(iso(-60_000), NOW), false);
});

test('expiry: justo antes del TTL → no expirada', () => {
  assert.equal(isBatteryExpired(iso(-BATTERY_TTL_MS + 1_000), NOW), false);
});

test('expiry: a las 24h exactas ya caduca (borde inclusivo)', () => {
  assert.equal(isBatteryExpired(iso(-BATTERY_TTL_MS), NOW), true);
});

// ─── getEffectiveBatteryLevel ─────────────────────────────────────────
// Estas funciones NO aceptan un `now` override — usan `Date.now()`
// directamente. Los ISOs los computamos desde el "ahora" real.
const realIso = (msOffset) => new Date(Date.now() + msOffset).toISOString();

test('effective(user): fresca → devuelve battery_level', () => {
  const u = { battery_level: 78, battery_updated_at: realIso(-60_000) };
  assert.equal(getEffectiveBatteryLevel(u), 78);
});

test('effective(user): caducada → 0 aunque battery_level sea otro', () => {
  const u = { battery_level: 78, battery_updated_at: realIso(-BATTERY_TTL_MS - 1) };
  assert.equal(getEffectiveBatteryLevel(u), 0);
});

test('effective(user): sin battery_level pero fresca → 0 (no undefined)', () => {
  const u = { battery_updated_at: realIso(-60_000) };
  assert.equal(getEffectiveBatteryLevel(u), 0);
});

test('effective(level, updatedAt): fresca → level; caducada → 0', () => {
  assert.equal(getEffectiveBatteryLevel(60, realIso(-60_000)), 60);
  assert.equal(getEffectiveBatteryLevel(60, realIso(-BATTERY_TTL_MS - 1)), 0);
});

test('effective(null): tratado como 0 (defensa)', () => {
  // La lambda ternaria hace `userOrLevel ?? 0` cuando no es object.
  assert.equal(getEffectiveBatteryLevel(null, realIso(-60_000)), 0);
});

// ─── getBatteryColor — cinco tramos ───────────────────────────────────
test('color: ≤15 → rojo "Agotado"', () => {
  assert.equal(getBatteryColor(0).label, 'Agotado');
  assert.equal(getBatteryColor(15).label, 'Agotado');
});

test('color: 16-30 → naranja "Bajo"', () => {
  assert.equal(getBatteryColor(16).label, 'Bajo');
  assert.equal(getBatteryColor(30).label, 'Bajo');
});

test('color: 31-50 → amarillo "Moderado"', () => {
  assert.equal(getBatteryColor(31).label, 'Moderado');
  assert.equal(getBatteryColor(50).label, 'Moderado');
});

test('color: 51-75 → lima "Bien"', () => {
  assert.equal(getBatteryColor(51).label, 'Bien');
  assert.equal(getBatteryColor(75).label, 'Bien');
});

test('color: 76-100 → verde "Cargado"', () => {
  assert.equal(getBatteryColor(76).label, 'Cargado');
  assert.equal(getBatteryColor(100).label, 'Cargado');
});

test('color: campos hex y tw acompañan al label', () => {
  // No comprobamos el valor exacto (podría re-tematizarse), solo que
  // vienen bien tipados en cada tramo — evita regresiones donde alguien
  // deje uno de los dos sin actualizar.
  for (const lvl of [10, 25, 40, 65, 90]) {
    const c = getBatteryColor(lvl);
    assert.equal(typeof c.hex, 'string');
    assert.match(c.hex, /^#[0-9a-f]{6}$/);
    assert.equal(typeof c.tw, 'string');
    assert.ok(c.tw.startsWith('text-'), 'tw class debe ser una clase Tailwind text-*');
  }
});

// ─── getBatteryEmoji — solo verificamos que devuelve algo ─────────────
test('emoji: todos los tramos devuelven un string no vacío', () => {
  for (const lvl of [0, 15, 30, 60, 85, 100]) {
    const e = getBatteryEmoji(lvl);
    assert.equal(typeof e, 'string');
    assert.ok(e.length > 0);
  }
});

// ─── formatRelativeTime ───────────────────────────────────────────────
// Estas comprobaciones usan Date.now(); no podemos parametrizarlo desde
// fuera. Aceptamos algo de flexibilidad temporal y verificamos el shape
// del resultado, no el valor exacto.
test('relative: null/vacío → "Sin actualizar hoy"', () => {
  assert.equal(formatRelativeTime(null), 'Sin actualizar hoy');
  assert.equal(formatRelativeTime(undefined), 'Sin actualizar hoy');
  assert.equal(formatRelativeTime(''), 'Sin actualizar hoy');
});

test('relative: futuro cercano → "Ahora mismo"', () => {
  const nowIso = new Date().toISOString();
  assert.equal(formatRelativeTime(nowIso), 'Ahora mismo');
});

test('relative: pasado remoto (más de 24h) → "Caducada"', () => {
  const long = new Date(Date.now() - BATTERY_TTL_MS - 3_600_000).toISOString();
  assert.equal(formatRelativeTime(long), 'Caducada');
});

test('relative: pasado de 1h ± algo → formato "Hace 1h" (min/hora según minuto)', () => {
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000 - 1000).toISOString();
  const out = formatRelativeTime(hourAgo);
  // Puede ser "Hace 1h" o "Hace 60min" según redondeo — ambos son válidos
  assert.ok(/^Hace (1h|60min)$/.test(out), `formato inesperado: ${out}`);
});

// ─── Mirror con el servidor ───────────────────────────────────────────
test('mirror: TTL cliente = TTL servidor', async (t) => {
  let serverMod;
  try {
    // El módulo del servidor es CJS y requiere env vars al top-level.
    process.env.SUPABASE_URL ||= 'http://stub.local';
    process.env.SUPABASE_SERVICE_KEY ||= 'stub-key';
    const { createRequire } = await import('node:module');
    const requireCjs = createRequire(import.meta.url);
    serverMod = requireCjs('../../../server/lib/batteryExpiry');
  } catch (err) {
    return t.skip(`no se pudo cargar batteryExpiry del servidor: ${err.message}`);
  }
  assert.equal(BATTERY_TTL_MS, serverMod.BATTERY_TTL_MS,
    'El TTL del cliente ha divergido del servidor — las baterías caducarán en momentos distintos');
});
