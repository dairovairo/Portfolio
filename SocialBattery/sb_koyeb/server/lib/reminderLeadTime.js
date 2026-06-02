const MIN_REMINDER_MINUTES = 10;
const MAX_REMINDER_MINUTES = 7 * 24 * 60;
const ONE_HOUR_MINUTES = 60;
const ONE_DAY_MINUTES = 24 * 60;
const ONE_WEEK_MINUTES = 7 * ONE_DAY_MINUTES;
const ONE_MONTH_MINUTES = 30 * ONE_DAY_MINUTES;
const THREE_MONTHS_MINUTES = 3 * ONE_MONTH_MINUTES;
const MAX_DEFAULT_REMINDER_MINUTES = ONE_MONTH_MINUTES;

function parseReminderMinutes(value) {
  const minutes = Number.parseInt(value, 10);
  if (!Number.isFinite(minutes)) return null;
  if (minutes < MIN_REMINDER_MINUTES || minutes > MAX_REMINDER_MINUTES) return null;
  return minutes;
}

function getDefaultReminderMinutes(startDate, plannedAt) {
  const startMs = new Date(startDate).getTime();
  const plannedMs = new Date(plannedAt).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(plannedMs) || startMs <= plannedMs) return [];

  const leadMinutes = Math.ceil((startMs - plannedMs) / 60000);
  if (leadMinutes <= ONE_DAY_MINUTES) return [ONE_HOUR_MINUTES];
  if (leadMinutes <= ONE_WEEK_MINUTES) return [ONE_DAY_MINUTES];
  if (leadMinutes <= THREE_MONTHS_MINUTES) return [ONE_WEEK_MINUTES, ONE_DAY_MINUTES];
  return [ONE_MONTH_MINUTES, ONE_WEEK_MINUTES, ONE_DAY_MINUTES];
}

function formatReminderLead(minutes) {
  if (minutes === ONE_MONTH_MINUTES) return '1 mes';
  if (minutes === ONE_WEEK_MINUTES) return '1 semana';
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
  ONE_HOUR_MINUTES,
  ONE_DAY_MINUTES,
  ONE_WEEK_MINUTES,
  ONE_MONTH_MINUTES,
  THREE_MONTHS_MINUTES,
  MAX_DEFAULT_REMINDER_MINUTES,
  parseReminderMinutes,
  getDefaultReminderMinutes,
  formatReminderLead,
};
