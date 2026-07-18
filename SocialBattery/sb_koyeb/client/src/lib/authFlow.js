// Helpers puros para el flujo de registro / login, extraídos de
// AuthContext para poder testearlos sin montar React ni mockear todo el
// cliente de Supabase.
//
// Nada aquí toca red ni estado: sólo interpretan los objetos que
// devuelve supabase-js. Se testean con node --test en authFlow.test.js.

/**
 * Interpreta la respuesta de supabase.auth.signUp cuando NO hubo error.
 *
 * Supabase, con "Confirm email" activo, oculta el caso de "email ya
 * registrado" devolviendo un data.user con `identities: []`. No podemos
 * saber desde aquí si esa cuenta ya estaba confirmada o no — para eso
 * habrá que hacer un resend después y mirar el error (isAlreadyConfirmedError).
 *
 * Casos:
 *   - 'created': usuario nuevo. El correo de confirmación va de camino.
 *   - 'obfuscated': el email ya existía. Hay que intentar resend para
 *     distinguir confirmado (mostrar "ya en uso") vs no confirmado
 *     (reenviar correo y llevar a "revisa tu email").
 *   - 'unknown': no llegó user en la respuesta — situación rara,
 *     tratamos como error para no dejar al usuario en limbo.
 */
export function interpretSignUpResult(data) {
  const user = data?.user;
  if (!user) return { kind: 'unknown' };
  if (Array.isArray(user.identities) && user.identities.length === 0) {
    return { kind: 'obfuscated' };
  }
  return { kind: 'created' };
}

/**
 * Dado el error de supabase.auth.resend({ type: 'signup' }), devuelve
 * true si el mensaje indica que la cuenta ya estaba confirmada.
 *
 * Se hace por matching de string porque Supabase no expone un código
 * estable para este caso; las variantes conocidas son:
 *   - "User already confirmed"
 *   - "Email has been confirmed"
 *   - "This email has already been confirmed"
 * La regex cubre las tres sin ser tan laxa como para tragarse
 * cualquier otro error que mencione la palabra "confirmed".
 */
export function isAlreadyConfirmedError(error) {
  if (!error) return false;
  const msg = error.message || '';
  return /already.*confirmed|confirmed.*already|has been confirmed/i.test(msg);
}

/**
 * True si el usuario devuelto por signInWithPassword tiene el email
 * SIN confirmar. Sirve como puerta client-side para que, aunque el
 * ajuste "Confirm email" del dashboard esté apagado, no dejemos pasar
 * a cuentas recién registradas que no han pinchado el enlace.
 *
 * Miramos tanto `email_confirmed_at` (gotrue moderno) como
 * `confirmed_at` (versiones antiguas) para no romper si Supabase cambia
 * el nombre del campo en una actualización.
 */
export function isEmailUnconfirmed(user) {
  if (!user) return false;
  return !user.email_confirmed_at && !user.confirmed_at;
}
