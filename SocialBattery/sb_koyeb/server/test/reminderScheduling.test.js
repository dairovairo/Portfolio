// Tests unitarios de server/lib/reminderScheduling.js — piezas puras
// del scheduling de recordatorios de eventos y quedadas. Correr con:
//
//   node --test server/test/reminderScheduling.test.js
//
// Cubre:
//   - getSearchWindow: ventana temporal que se manda a Supabase para
//     acotar la búsqueda del próximo tick del cron.
//   - normalizeReminderMinutes: validación del reminder personalizado.
//   - getReminderOffsets: combinación de defaults por adelantamiento +
//     custom del usuario, deduplicado.
//   - isReminderDue: comparación con ventana de tolerancia de ±30s.
//   - groupDueRecipients: agrupación por offset con dedup contra el Set
//     de "ya notificados" que persiste entre ticks.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  REMINDER_WINDOW_MS,
  getSearchWindow,
  normalizeReminderMinutes,
  getReminderOffsets,
  isReminderDue,
  groupDueRecipients,
} = require('../lib/reminderScheduling');
const {
  MIN_REMINDER_MINUTES,
  MAX_REMINDER_MINUTES,
  ONE_HOUR_MINUTES,
  ONE_DAY_MINUTES,
  ONE_WEEK_MINUTES,
  ONE_MONTH_MINUTES,
} = require('../lib/reminderLeadTime');

const NOW = new Date('2026-07-01T12:00:00Z');

// ─── getSearchWindow ──────────────────────────────────────────────────
test('window: la ventana empieza ~MIN_REMINDER minutos en el futuro', () => {
  const w = getSearchWindow(NOW);
  const minMs = NOW.getTime() + MIN_REMINDER_MINUTES * 60 * 1000 - REMINDER_WINDOW_MS / 2;
  assert.equal(w.start.getTime(), minMs);
});

test('window: la ventana acaba ~MAX(MAX_REMINDER, MAX_DEFAULT) minutos en el futuro', () => {
  // MAX_REMINDER es 1 semana; MAX_DEFAULT es 1 mes. Debe ganar el
  // máximo de los dos — si el defecto es más ancho que el que puede
  // elegir el usuario (caso actual), el mes debe extender la ventana.
  const w = getSearchWindow(NOW);
  const expectedMax = Math.max(MAX_REMINDER_MINUTES, ONE_MONTH_MINUTES);
  const endMs = NOW.getTime() + expectedMax * 60 * 1000 + REMINDER_WINDOW_MS / 2;
  assert.equal(w.end.getTime(), endMs);
});

test('window: end > start siempre', () => {
  const w = getSearchWindow(NOW);
  assert.ok(w.end.getTime() > w.start.getTime());
});

// ─── normalizeReminderMinutes ─────────────────────────────────────────
test('normalize: entero dentro del rango se devuelve tal cual', () => {
  assert.equal(normalizeReminderMinutes(60), 60);
  assert.equal(normalizeReminderMinutes(ONE_DAY_MINUTES), ONE_DAY_MINUTES);
});

test('normalize: string numérica se convierte', () => {
  assert.equal(normalizeReminderMinutes('120'), 120);
});

test('normalize: bordes exactos aceptados', () => {
  assert.equal(normalizeReminderMinutes(MIN_REMINDER_MINUTES), MIN_REMINDER_MINUTES);
  assert.equal(normalizeReminderMinutes(MAX_REMINDER_MINUTES), MAX_REMINDER_MINUTES);
});

test('normalize: fuera de rango → null (no clamp)', () => {
  assert.equal(normalizeReminderMinutes(MIN_REMINDER_MINUTES - 1), null);
  assert.equal(normalizeReminderMinutes(MAX_REMINDER_MINUTES + 1), null);
});

test('normalize: valores no numéricos → null', () => {
  assert.equal(normalizeReminderMinutes(null), null);
  assert.equal(normalizeReminderMinutes(undefined), null);
  assert.equal(normalizeReminderMinutes('quizá'), null);
  assert.equal(normalizeReminderMinutes({}), null);
});

// ─── getReminderOffsets ───────────────────────────────────────────────
// Helper: construye la fila del participante con joined_at derivado de
// cuántas horas antes de la fecha de inicio quería planificarlo.
function makeRow({ hoursAhead, customMinutes = null }) {
  const start = new Date(NOW.getTime() + hoursAhead * 60 * 60 * 1000);
  const joinedAt = NOW.toISOString();
  return {
    row: { user_id: 'u1', joined_at: joinedAt, reminder_minutes_before: customMinutes },
    start,
  };
}

test('offsets: sin custom y planeado con < 1 día → solo [1h]', () => {
  const { row, start } = makeRow({ hoursAhead: 5 });
  const offsets = [...getReminderOffsets(row, start)];
  assert.deepEqual(offsets.sort((a, b) => a - b), [ONE_HOUR_MINUTES]);
});

test('offsets: sin custom y planeado con 2 días → [1d, 1h]', () => {
  const { row, start } = makeRow({ hoursAhead: 48 });
  const offsets = [...getReminderOffsets(row, start)].sort((a, b) => a - b);
  assert.deepEqual(offsets, [ONE_HOUR_MINUTES, ONE_DAY_MINUTES]);
});

test('offsets: con custom añade sin duplicar los defaults', () => {
  const { row, start } = makeRow({ hoursAhead: 48, customMinutes: 30 });
  const offsets = [...getReminderOffsets(row, start)].sort((a, b) => a - b);
  // 30 se añade, y los defaults del tramo 1día-1sem [1d, 1h] siguen.
  assert.deepEqual(offsets, [30, ONE_HOUR_MINUTES, ONE_DAY_MINUTES]);
});

test('offsets: custom que coincide con un default no duplica', () => {
  const { row, start } = makeRow({ hoursAhead: 48, customMinutes: ONE_HOUR_MINUTES });
  const offsets = [...getReminderOffsets(row, start)].sort((a, b) => a - b);
  assert.deepEqual(offsets, [ONE_HOUR_MINUTES, ONE_DAY_MINUTES]);
});

test('offsets: custom inválido se ignora, solo quedan defaults', () => {
  const { row, start } = makeRow({ hoursAhead: 48, customMinutes: 999999 });
  const offsets = [...getReminderOffsets(row, start)].sort((a, b) => a - b);
  assert.deepEqual(offsets, [ONE_HOUR_MINUTES, ONE_DAY_MINUTES]);
});

// ─── isReminderDue ────────────────────────────────────────────────────
// El evento empieza a startDate; queremos avisar `reminderMinutes` antes.
// Devuelve true si `now` está a menos de REMINDER_WINDOW_MS/2 del
// instante objetivo (start - reminderMinutes).
test('due: exactamente en el instante objetivo → true', () => {
  // Evento a las 13:00, aviso 1h antes → objetivo = 12:00 = NOW
  const start = new Date(NOW.getTime() + 60 * 60 * 1000);
  assert.equal(isReminderDue(NOW, start, 60), true);
});

test('due: dentro de la ventana de tolerancia (±30s) → true', () => {
  const start = new Date(NOW.getTime() + 60 * 60 * 1000);
  const nowMinus29s = new Date(NOW.getTime() - 29_000);
  const nowPlus29s = new Date(NOW.getTime() + 29_000);
  assert.equal(isReminderDue(nowMinus29s, start, 60), true);
  assert.equal(isReminderDue(nowPlus29s, start, 60), true);
});

test('due: fuera de la ventana (±31s) → false', () => {
  const start = new Date(NOW.getTime() + 60 * 60 * 1000);
  const nowMinus31s = new Date(NOW.getTime() - 31_000);
  const nowPlus31s = new Date(NOW.getTime() + 31_000);
  assert.equal(isReminderDue(nowMinus31s, start, 60), false);
  assert.equal(isReminderDue(nowPlus31s, start, 60), false);
});

test('due: evento ya empezó (falta negativo) → false', () => {
  const start = new Date(NOW.getTime() - 60 * 60 * 1000); // hace 1h
  assert.equal(isReminderDue(NOW, start, 60), false);
});

test('due: fecha de inicio inválida → false, no lanza', () => {
  assert.equal(isReminderDue(NOW, 'no-fecha', 60), false);
  assert.equal(isReminderDue(NOW, null, 60), false);
});

// ─── groupDueRecipients ───────────────────────────────────────────────
test('group: agrupa por offset, un solo usuario a la vez', () => {
  const start = new Date(NOW.getTime() + 60 * 60 * 1000); // 1h después
  const rows = [
    { user_id: 'a', joined_at: NOW.toISOString(), reminder_minutes_before: null },
    { user_id: 'b', joined_at: NOW.toISOString(), reminder_minutes_before: null },
  ];
  const notified = new Set();
  const groups = groupDueRecipients({ rows, idPrefix: 'pool:X', notifiedSet: notified, now: NOW, startDate: start });
  // A 1h de distancia, con joined_at = NOW, hay tramo < 1 día → [1h]
  assert.deepEqual([...groups.keys()], [60]);
  assert.deepEqual(groups.get(60).sort(), ['a', 'b']);
});

test('group: el Set de "ya notificados" evita repetir en un segundo tick', () => {
  const start = new Date(NOW.getTime() + 60 * 60 * 1000);
  const rows = [
    { user_id: 'a', joined_at: NOW.toISOString(), reminder_minutes_before: null },
  ];
  const notified = new Set();
  const first = groupDueRecipients({ rows, idPrefix: 'pool:X', notifiedSet: notified, now: NOW, startDate: start });
  assert.deepEqual(first.get(60), ['a']);
  // Segundo tick con el mismo Set (típico entre dos ejecuciones del cron
  // dentro de la misma ventana) — no debe volver a incluir a 'a'.
  const second = groupDueRecipients({ rows, idPrefix: 'pool:X', notifiedSet: notified, now: NOW, startDate: start });
  assert.equal(second.size, 0);
});

test('group: idPrefix diferente permite re-notificar al mismo user_id', () => {
  // Un usuario está en un pool Y en un evento con el mismo id local (rar
  // pero posible entre tablas distintas). El prefix separa los espacios
  // de claves, así que un pool no bloquea el aviso del evento.
  const start = new Date(NOW.getTime() + 60 * 60 * 1000);
  const rows = [{ user_id: 'a', joined_at: NOW.toISOString(), reminder_minutes_before: null }];
  const notified = new Set();
  groupDueRecipients({ rows, idPrefix: 'pool:X', notifiedSet: notified, now: NOW, startDate: start });
  const eventGroups = groupDueRecipients({ rows, idPrefix: 'event:X', notifiedSet: notified, now: NOW, startDate: start });
  assert.deepEqual(eventGroups.get(60), ['a']);
});

test('group: sin usuarios / rows null → Map vacío, no lanza', () => {
  const notified = new Set();
  assert.equal(
    groupDueRecipients({ rows: null, idPrefix: 'p', notifiedSet: notified, now: NOW, startDate: NOW }).size,
    0
  );
  assert.equal(
    groupDueRecipients({ rows: [], idPrefix: 'p', notifiedSet: notified, now: NOW, startDate: NOW }).size,
    0
  );
});

test('group: rows sin user_id se ignoran (defensa)', () => {
  const start = new Date(NOW.getTime() + 60 * 60 * 1000);
  const rows = [
    { user_id: null, joined_at: NOW.toISOString() },
    { joined_at: NOW.toISOString() }, // falta user_id
    { user_id: 'ok', joined_at: NOW.toISOString() },
  ];
  const notified = new Set();
  const groups = groupDueRecipients({ rows, idPrefix: 'p', notifiedSet: notified, now: NOW, startDate: start });
  assert.deepEqual(groups.get(60), ['ok']);
});

test('group: en tramo largo (> 1 sem), un solo tick puede tocar varios offsets simultáneos', () => {
  // Escenario: el usuario se apuntó hace 2 semanas a un evento que
  // empieza ahora + 1 semana. Distancia planificada = 3 semanas → tramo
  // "< 3 meses" → defaults [1sem, 1d, 1h]. AHORA queda exactamente 1
  // semana para el inicio → el offset de "1 semana antes" dispara; los
  // de 1 día / 1 hora antes todavía no.
  const start = new Date(NOW.getTime() + ONE_WEEK_MINUTES * 60 * 1000);
  const joinedAt = new Date(NOW.getTime() - 2 * ONE_WEEK_MINUTES * 60 * 1000).toISOString();
  const rows = [{ user_id: 'a', joined_at: joinedAt, reminder_minutes_before: null }];
  const notified = new Set();
  const groups = groupDueRecipients({ rows, idPrefix: 'p', notifiedSet: notified, now: NOW, startDate: start });
  assert.deepEqual([...groups.keys()], [ONE_WEEK_MINUTES]);
});
