// Tests unitarios de server/lib/reminderLeadTime.js — cálculo de los
// recordatorios por defecto de eventos y quedadas según cuánto tiempo
// falta hasta el inicio. Correr con:
//
//   node --test server/test/reminderLeadTime.test.js
//
// Los defaults van escalonados en 4 tramos:
//   [inicio - ahora] < 1 día   → [1h antes]
//   [inicio - ahora] < 1 sem   → [1d, 1h]
//   [inicio - ahora] < 3 mes   → [1sem, 1d, 1h]
//   [inicio - ahora] ≥ 3 mes   → [1mes, 1sem, 1d, 1h]

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MIN_REMINDER_MINUTES,
  MAX_REMINDER_MINUTES,
  ONE_HOUR_MINUTES,
  ONE_DAY_MINUTES,
  ONE_WEEK_MINUTES,
  ONE_MONTH_MINUTES,
  parseReminderMinutes,
  getDefaultReminderMinutes,
  formatReminderLead,
} = require('../lib/reminderLeadTime');

// ─── parseReminderMinutes ─────────────────────────────────────────────
test('parse: number válido dentro del rango se devuelve tal cual', () => {
  assert.equal(parseReminderMinutes(60), 60);
  assert.equal(parseReminderMinutes(1440), 1440);
});

test('parse: string numérica se convierte con parseInt', () => {
  assert.equal(parseReminderMinutes('60'), 60);
  assert.equal(parseReminderMinutes('120.9'), 120);  // parseInt trunca
});

test('parse: por debajo del mínimo → null', () => {
  assert.equal(parseReminderMinutes(MIN_REMINDER_MINUTES - 1), null);
  assert.equal(parseReminderMinutes(0), null);
  assert.equal(parseReminderMinutes(-5), null);
});

test('parse: por encima del máximo → null', () => {
  assert.equal(parseReminderMinutes(MAX_REMINDER_MINUTES + 1), null);
  assert.equal(parseReminderMinutes(1_000_000), null);
});

test('parse: bordes exactos son aceptados', () => {
  assert.equal(parseReminderMinutes(MIN_REMINDER_MINUTES), MIN_REMINDER_MINUTES);
  assert.equal(parseReminderMinutes(MAX_REMINDER_MINUTES), MAX_REMINDER_MINUTES);
});

test('parse: valores no numéricos → null', () => {
  assert.equal(parseReminderMinutes(null), null);
  assert.equal(parseReminderMinutes(undefined), null);
  assert.equal(parseReminderMinutes('mañana'), null);
  assert.equal(parseReminderMinutes({}), null);
});

// ─── getDefaultReminderMinutes — cada tramo ───────────────────────────
const REF = new Date('2026-07-01T12:00:00Z');
const inHours = (h) => new Date(REF.getTime() + h * 60 * 60 * 1000);

test('defaults: < 1 día → solo [1h]', () => {
  assert.deepEqual(getDefaultReminderMinutes(inHours(2), REF), [ONE_HOUR_MINUTES]);
  assert.deepEqual(getDefaultReminderMinutes(inHours(23), REF), [ONE_HOUR_MINUTES]);
});

test('defaults: exactamente 1 día cae en el tramo "< 1 día" (borde inclusivo)', () => {
  // El código es `if (leadMinutes <= ONE_DAY_MINUTES)` — a 24h justas se
  // aplica la lista corta. Es la lectura natural del comparador.
  assert.deepEqual(getDefaultReminderMinutes(inHours(24), REF), [ONE_HOUR_MINUTES]);
});

test('defaults: entre 1 día y 1 semana → [1d, 1h]', () => {
  assert.deepEqual(getDefaultReminderMinutes(inHours(48), REF), [ONE_DAY_MINUTES, ONE_HOUR_MINUTES]);
  assert.deepEqual(getDefaultReminderMinutes(inHours(24 * 6), REF), [ONE_DAY_MINUTES, ONE_HOUR_MINUTES]);
});

test('defaults: entre 1 semana y 3 meses → [1sem, 1d, 1h]', () => {
  assert.deepEqual(
    getDefaultReminderMinutes(inHours(24 * 10), REF),
    [ONE_WEEK_MINUTES, ONE_DAY_MINUTES, ONE_HOUR_MINUTES]
  );
  // A 89 días (< 3 meses de 30 días) todavía es tramo "3 meses"
  assert.deepEqual(
    getDefaultReminderMinutes(inHours(24 * 89), REF),
    [ONE_WEEK_MINUTES, ONE_DAY_MINUTES, ONE_HOUR_MINUTES]
  );
});

test('defaults: ≥ 3 meses → [1mes, 1sem, 1d, 1h]', () => {
  // 3 meses = 90 días. A partir del día 91 se activa la lista larga.
  assert.deepEqual(
    getDefaultReminderMinutes(inHours(24 * 91), REF),
    [ONE_MONTH_MINUTES, ONE_WEEK_MINUTES, ONE_DAY_MINUTES, ONE_HOUR_MINUTES]
  );
});

test('defaults: inicio ya pasado o mismo instante → lista vacía', () => {
  assert.deepEqual(getDefaultReminderMinutes(REF, REF), []);
  assert.deepEqual(getDefaultReminderMinutes(inHours(-1), REF), []);
});

test('defaults: fechas inválidas → lista vacía (defensa)', () => {
  assert.deepEqual(getDefaultReminderMinutes('no-fecha', REF), []);
  assert.deepEqual(getDefaultReminderMinutes(inHours(24), 'no-fecha'), []);
});

// ─── formatReminderLead ────────────────────────────────────────────────
test('format: bordes exactos usan la etiqueta simbólica', () => {
  assert.equal(formatReminderLead(ONE_MONTH_MINUTES), '1 mes');
  assert.equal(formatReminderLead(ONE_WEEK_MINUTES), '1 semana');
});

test('format: múltiplos exactos de días', () => {
  assert.equal(formatReminderLead(ONE_DAY_MINUTES), '1 dia');
  assert.equal(formatReminderLead(2 * ONE_DAY_MINUTES), '2 dias');
});

test('format: horas exactas', () => {
  assert.equal(formatReminderLead(ONE_HOUR_MINUTES), '1 hora');
  assert.equal(formatReminderLead(3 * ONE_HOUR_MINUTES), '3 horas');
});

test('format: minutos sueltos', () => {
  assert.equal(formatReminderLead(1), '1 minuto');
  assert.equal(formatReminderLead(45), '45 minutos');
});
