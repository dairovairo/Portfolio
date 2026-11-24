/**
 * notificationDay.js — Día y horario de las notificaciones promocionales.
 *
 * La clave del día va en user_daily_notification_claims.claim_date (tope de
 * 1 notificación por usuario y día entre todos los eventos). Se calcula en
 * hora peninsular: con UTC el "día" empezaba a la 1:00-2:00 de la madrugada
 * y era entonces cuando salían todas las promociones.
 */
const TIME_ZONE = 'Europe/Madrid';
const SEND_FROM_HOUR = 10;
const SEND_UNTIL_HOUR = 21;

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});
const hourFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE, hour: '2-digit', hourCycle: 'h23',
});

function getNotificationDayKey(date = new Date()) {
  return dayFormat.format(date); // 'YYYY-MM-DD'
}

/** ¿Se pueden enviar promociones ahora? De 10:00 a 21:00, hora peninsular. */
function isPromoSendingTime(date = new Date()) {
  const hour = Number(hourFormat.format(date));
  return hour >= SEND_FROM_HOUR && hour < SEND_UNTIL_HOUR;
}

module.exports = { getNotificationDayKey, isPromoSendingTime, SEND_FROM_HOUR, SEND_UNTIL_HOUR };
