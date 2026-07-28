// Tests unitarios de dos helpers pequeños pero muy usados. Correr con:
//
//   node --test server/test/dateHelpers.test.js
//
// dateRangeLimits.js (addYears / addMonths / addDays):
//   Se usa en rutas de eventos y quedadas para validar que fechas de
//   inicio/fin no queden demasiado lejos. Un bug aquí bloquea eventos
//   legítimos o deja pasar fechas absurdas.
//
// notificationDay.js (getNotificationDayKey):
//   Clave "hoy en UTC" para el tope de 1 notificación/usuario/día. Si
//   cambia respecto a cómo el resto del sistema calcula "hoy", se rompe
//   el tope silenciosamente y algunos usuarios reciben más pushes.

const test = require('node:test');
const assert = require('node:assert/strict');

const { addYears, addMonths, addDays } = require('../lib/dateRangeLimits');
const { getNotificationDayKey } = require('../lib/notificationDay');

// ─── addYears / addMonths / addDays ───────────────────────────────────

test('addDays: suma trivial no cruza fronteras', () => {
  const d = new Date('2026-07-01T12:00:00Z');
  const out = addDays(d, 5);
  assert.equal(out.toISOString(), '2026-07-06T12:00:00.000Z');
});

test('addDays: número negativo resta', () => {
  const d = new Date('2026-07-01T12:00:00Z');
  const out = addDays(d, -1);
  assert.equal(out.toISOString(), '2026-06-30T12:00:00.000Z');
});

test('addDays: no muta la fecha original', () => {
  // setDate() muta el Date sobre el que se llama; el helper debe partir
  // de una copia. Este test amarra ese detalle.
  const d = new Date('2026-07-01T12:00:00Z');
  const before = d.toISOString();
  addDays(d, 30);
  assert.equal(d.toISOString(), before);
});

test('addMonths: suma cruzando cambio de año', () => {
  const d = new Date('2026-11-15T00:00:00Z');
  const out = addMonths(d, 3);
  assert.equal(out.getUTCFullYear(), 2027);
  assert.equal(out.getUTCMonth(), 1); // febrero (0-indexed)
});

test('addMonths: al día 31 en mes de 30 días → cae al primero del siguiente (regla nativa de setMonth)', () => {
  // Comportamiento estándar de Date.setMonth: 31/enero + 1 mes = 3 de
  // marzo (no 28 de febrero). Es un gotcha conocido de JS; verificamos
  // que el helper NO intenta "arreglar" ese comportamiento (haría más
  // mal que bien).
  const d = new Date('2026-01-31T12:00:00Z');
  const out = addMonths(d, 1);
  // Cae en marzo, no en febrero — el mes en que aterriza es +2 respecto
  // al original en este caso concreto por overflow del día.
  assert.equal(out.getUTCMonth(), 2, 'marzo por overflow del 31');
});

test('addYears: suma cruza correctamente y no muta', () => {
  const d = new Date('2026-07-01T12:00:00Z');
  const before = d.toISOString();
  const out = addYears(d, 2);
  assert.equal(out.getUTCFullYear(), 2028);
  assert.equal(d.toISOString(), before);
});

test('addYears: 29 de febrero en año bisiesto → desborda al 1 de marzo del siguiente año', () => {
  // Bisiesto 2028 → +1 año = 2029 (no bisiesto). 29 no existe en feb
  // 2029; JS avanza al 1 de marzo (comportamiento real de setFullYear).
  // Documentamos ese comportamiento para que si algún día alguien intenta
  // "arreglarlo" (para forzar 28 feb en lugar de 1 mar), vea que el test
  // lo cubre a propósito.
  const d = new Date('2028-02-29T12:00:00Z');
  const out = addYears(d, 1);
  assert.equal(out.getUTCFullYear(), 2029);
  assert.equal(out.getUTCMonth(), 2, 'marzo por overflow del 29 en año no bisiesto');
  assert.equal(out.getUTCDate(), 1);
});

test('addYears/addMonths/addDays: acepta string ISO tanto como Date', () => {
  // El helper hace new Date(date) al principio. Debe aceptar ambos.
  const asStr = addDays('2026-07-01T12:00:00Z', 1);
  const asDate = addDays(new Date('2026-07-01T12:00:00Z'), 1);
  assert.equal(asStr.toISOString(), asDate.toISOString());
});

// ─── getNotificationDayKey ────────────────────────────────────────────

test('notifDay: devuelve YYYY-MM-DD en UTC', () => {
  const key = getNotificationDayKey(new Date('2026-07-01T12:00:00Z'));
  assert.equal(key, '2026-07-01');
});

test('notifDay: usa UTC, no la zona local del proceso', () => {
  // Un instante a las 23:30 UTC del 30/jun sigue siendo "30 de junio"
  // por UTC, aunque en zonas horarias positivas ya sea 1 de julio.
  const late = new Date('2026-06-30T23:30:00Z');
  assert.equal(getNotificationDayKey(late), '2026-06-30');
});

test('notifDay: cruce de medianoche UTC cambia la clave', () => {
  const before = new Date('2026-06-30T23:59:59Z');
  const after = new Date('2026-07-01T00:00:01Z');
  assert.equal(getNotificationDayKey(before), '2026-06-30');
  assert.equal(getNotificationDayKey(after), '2026-07-01');
});

test('notifDay: sin argumento usa "ahora" y devuelve un string YYYY-MM-DD', () => {
  const key = getNotificationDayKey();
  assert.match(key, /^\d{4}-\d{2}-\d{2}$/);
});

test('notifDay: el formato es exactamente 10 caracteres — cabe tal cual en una columna DATE', () => {
  // Se usa como columna DATE en user_daily_notification_claims. Cualquier
  // cambio de formato la rompería (por ejemplo, si alguien añadiera 'Z'
  // al final o el mes fuera 1 dígito).
  const key = getNotificationDayKey(new Date('2026-07-01T12:00:00Z'));
  assert.equal(key.length, 10);
});

test('notifDay: enero (mes 0-indexed) sale como "01", no "1"', () => {
  const key = getNotificationDayKey(new Date('2026-01-05T12:00:00Z'));
  assert.equal(key, '2026-01-05');
});
