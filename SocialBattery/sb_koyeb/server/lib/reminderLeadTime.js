const MIN_REMINDER_MINUTES = 10;
const MAX_REMINDER_MINUTES = 7 * 24 * 60;
const DEFAULT_POOL_REMINDER_MINUTES = 10;
const DEFAULT_EVENT_REMINDER_MINUTES = 24 * 60;

function parseReminderMinutes(value) {
  const minutes = Number.parseInt(value, 10);
  if (!Number.isFinite(minutes)) return null;
  if (minutes < MIN_REMINDER_MINUTES || minutes > MAX_REMINDER_MINUTES) return null;
  return minutes;
}

function formatReminderLead(minutes) {
  if (minutes >= 24 * 60 && minutes % (24 * 60) === 0) {
    const days = minutes / (24 * 60);
    return days === 1 ? '1 dia' : `${days} dias`;
  }
  if (minutes >= 60 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? '1 hora' : `${hours} horas`;
  }
  return minutes === 1 ? '1 minuto' : `${minutes} minutos`;
}

module.exports = {
  MIN_REMINDER_MINUTES,
  MAX_REMINDER_MINUTES,
  DEFAULT_POOL_REMINDER_MINUTES,
  DEFAULT_EVENT_REMINDER_MINUTES,
  parseReminderMinutes,
  formatReminderLead,
};
