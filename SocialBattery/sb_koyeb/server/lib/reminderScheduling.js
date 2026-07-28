/**
 * reminderScheduling.js — Lógica pura del scheduling de recordatorios.
 *
 * Estas funciones vivían inline en server/jobs/reminders.js. Se extraen
 * aquí para poder testearlas sin arrancar el job entero (que tira de
 * Supabase y webpush).
 *
 * Se importan desde reminders.js — el job se queda solo con las partes
 * que sí tocan I/O (cargar filas de la BD, enviar los pushes).
 *
 * Definiciones que usa el resto del módulo:
 *
 *   - REMINDER_WINDOW_MS: ventana de tolerancia alrededor del instante
 *     objetivo. El cron corre cada minuto, así que si el minuto marcado
 *     se cae por saturación o retraso, la ventana de ±30s hace que en el
 *     tick siguiente todavía se dispare — mejor "1 minuto tarde" que
 *     "nunca".
 *
 *   - MIN_REMINDER_MINUTES / MAX_REMINDER_MINUTES: valores que puede
 *     elegir el usuario para su recordatorio personalizado. Fuera del
 *     rango se ignora silenciosamente.
 */

const {
  MIN_REMINDER_MINUTES,
  MAX_REMINDER_MINUTES,
  MAX_DEFAULT_REMINDER_MINUTES,
  getDefaultReminderMinutes,
} = require('./reminderLeadTime');

const REMINDER_WINDOW_MS = 60 * 1000;

// Ventana de búsqueda de eventos/quedadas para el próximo tick. Se
// expande MIN..MAX minutos alrededor de ahora, +/- media ventana de
// tolerancia. La consulta de Supabase filtra por start_at BETWEEN
// window.start y window.end para no traer TODO lo futuro cada tick.
function getSearchWindow(now = new Date()) {
  const maxReminderMinutes = Math.max(MAX_REMINDER_MINUTES, MAX_DEFAULT_REMINDER_MINUTES);
  return {
    start: new Date(now.getTime() + (MIN_REMINDER_MINUTES * 60 * 1000) - (REMINDER_WINDOW_MS / 2)),
    end: new Date(now.getTime() + (maxReminderMinutes * 60 * 1000) + (REMINDER_WINDOW_MS / 2)),
  };
}

// Valida un valor de reminder_minutes_before viniendo de la BD (podría
// ser string, decimal, fuera de rango…). Devuelve el entero o null.
function normalizeReminderMinutes(value) {
  const minutes = Number.parseInt(value, 10);
  if (Number.isFinite(minutes) && minutes >= MIN_REMINDER_MINUTES && minutes <= MAX_REMINDER_MINUTES) {
    return minutes;
  }
  return null;
}

// Devuelve los offsets (en minutos) a los que este usuario debe recibir
// recordatorio para un evento/quedada dado: los defaults según cuánto
// tiempo tuvo para planificarlo (row.joined_at) más su valor
// personalizado si es válido. Set para dedup si custom coincide con un
// default.
function getReminderOffsets(row, startDate) {
  const offsets = new Set(getDefaultReminderMinutes(startDate, row?.joined_at));
  const customMinutes = normalizeReminderMinutes(row?.reminder_minutes_before);
  if (customMinutes != null) offsets.add(customMinutes);
  return offsets;
}

// ¿Toca disparar el recordatorio ahora? Sí sii |Δ − reminder| ≤ ventana/2.
// startDate acepta ISO string o Date. Fecha inválida → false (no dispara).
function isReminderDue(now, startDate, reminderMinutes) {
  const startMs = new Date(startDate).getTime();
  if (Number.isNaN(startMs)) return false;
  const reminderMs = reminderMinutes * 60 * 1000;
  const diff = startMs - now.getTime();
  return Math.abs(diff - reminderMs) <= REMINDER_WINDOW_MS / 2;
}

// Agrupa usuarios por offset (10min antes, 1h antes, 1día antes…) para
// enviar en batches con el mismo texto ("Faltan 10 minutos para X").
// Deduplica contra un Set en memoria que persiste entre ticks del cron
// (dentro del proceso; en Railway el proceso es de larga duración) —
// evita que si dos ticks caen dentro de la misma ventana se envíe dos
// veces al mismo usuario. La clave incluye idPrefix ("pool" / "event")
// para no colisionar entre entidades con el mismo user_id.
function groupDueRecipients({ rows, idPrefix, notifiedSet, now, startDate }) {
  const groups = new Map();

  for (const row of rows || []) {
    if (!row?.user_id) continue;

    for (const reminderMinutes of getReminderOffsets(row, startDate)) {
      if (!isReminderDue(now, startDate, reminderMinutes)) continue;

      const key = `${idPrefix}:${row.user_id}:${reminderMinutes}`;
      if (notifiedSet.has(key)) continue;
      notifiedSet.add(key);

      if (!groups.has(reminderMinutes)) groups.set(reminderMinutes, []);
      groups.get(reminderMinutes).push(row.user_id);
    }
  }

  return groups;
}

module.exports = {
  REMINDER_WINDOW_MS,
  getSearchWindow,
  normalizeReminderMinutes,
  getReminderOffsets,
  isReminderDue,
  groupDueRecipients,
};
