/**
 * notificationDay.js — Clave de "día" compartida para el tope de 1
 * notificación/usuario/día (across events).
 *
 * Se usa como columna `claim_date` (DATE) en user_daily_notification_claims.
 * Usar SIEMPRE esta función en vez de `new Date().toISOString().slice(0,10)`
 * suelto por el código, para que server/jobs/eventPromoPacing.js y
 * server/routes/community.js calculen "hoy" exactamente igual (UTC), sin
 * depender de la zona horaria local del proceso (Railway no fija TZ, así
 * que Node usa UTC por defecto, pero mejor no dejarlo implícito).
 */
function getNotificationDayKey(date = new Date()) {
  return date.toISOString().slice(0, 10); // 'YYYY-MM-DD' en UTC
}

module.exports = { getNotificationDayKey };
