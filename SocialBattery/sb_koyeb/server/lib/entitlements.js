// ─────────────────────────────────────────────────────────────────────────
// Qué incluye cada suscripción
// ─────────────────────────────────────────────────────────────────────────
//   · Gratis: 1 actividad activa (evento o sorteo) en total.
//   · Enterprise: hasta 4 activas por comunidad, sorteos Community,
//     colaboraciones económicas y panel avanzado. Sin anuncios.
//   · Volt: sin anuncios, Volts semanales, crear grupos del localizador y 3
//     papeletas en los sorteos Volt.
//
// Con los pagos apagados (PAYMENTS_ENABLED) nadie puede suscribirse y todo está
// abierto, con un tope de actividades por cuenta para que nadie acapare la app
// creando comunidades. El tope de promociones está en lib/freePromo.js.

const supabase = require('./supabase');
const { paymentsEnabled } = require('./wallet');

const ACTIVE_ACTIVITY_LIMIT_PER_COMMUNITY = 4;
const FREE_ACTIVE_ACTIVITY_LIMIT = 1;
const LAUNCH_ACTIVE_ACTIVITY_LIMIT = 8; // por cuenta, con los pagos apagados

class EntitlementError extends Error {
  constructor(message, body, status = 403) {
    super(message);
    this.status = status;
    this.body = { error: message, ...body };
  }
}

async function getEntitlements(userId) {
  if (!paymentsEnabled()) return { enforced: false, isVolt: true, isEnterprise: true };
  const { data, error } = await supabase
    .from('users').select('is_volt_subscriber, is_enterprise').eq('id', userId).maybeSingle();
  if (error) throw error;
  return {
    enforced: true,
    isVolt: !!data?.is_volt_subscriber,
    isEnterprise: !!data?.is_enterprise,
  };
}

async function countActive(rpc, params) {
  const { data, error } = await supabase.rpc(rpc, params);
  if (error) throw error;
  return Number(data) || 0;
}

const getActiveActivityCount = (communityId) =>
  countActive('community_active_activity_count', { p_community_id: communityId });

/** Lanza EntitlementError si no se puede crear otra actividad. */
async function assertCanCreateActivity(userId, communityId) {
  const { enforced, isEnterprise } = await getEntitlements(userId);
  if (enforced && !isEnterprise) {
    const mine = await countActive('user_active_activity_count', { p_user_id: userId });
    if (mine >= FREE_ACTIVE_ACTIVITY_LIMIT) {
      throw new EntitlementError(
        'Con el plan gratis puedes tener 1 evento o sorteo activo. Suscríbete a Enterprise para tener hasta 4 por comunidad.',
        { code: 'enterprise_required', feature: 'activities', active_activity_count: mine, active_activity_limit: FREE_ACTIVE_ACTIVITY_LIMIT });
    }
  }
  if (!enforced) {
    const mine = await countActive('user_active_activity_count', { p_user_id: userId });
    if (mine >= LAUNCH_ACTIVE_ACTIVITY_LIMIT) {
      throw new EntitlementError(
        `Ya tienes ${mine} eventos o sorteos activos, el máximo por cuenta es ${LAUNCH_ACTIVE_ACTIVITY_LIMIT}. Espera a que alguno acabe antes de crear otro.`,
        { code: 'activity_cap_reached', active_activity_count: mine, active_activity_limit: LAUNCH_ACTIVE_ACTIVITY_LIMIT },
        400);
    }
  }
  const count = await getActiveActivityCount(communityId);
  if (count >= ACTIVE_ACTIVITY_LIMIT_PER_COMMUNITY) {
    throw new EntitlementError(
      `Ya tienes ${count}/${ACTIVE_ACTIVITY_LIMIT_PER_COMMUNITY} actividades activas en esta comunidad (eventos + sorteos). Espera a que alguna acabe o finalízala antes de crear otra.`,
      { code: 'activity_cap_reached', active_activity_count: count, active_activity_limit: ACTIVE_ACTIVITY_LIMIT_PER_COMMUNITY },
      400);
  }
}

async function assertEnterprise(userId, feature, message) {
  const { enforced, isEnterprise } = await getEntitlements(userId);
  if (enforced && !isEnterprise) {
    throw new EntitlementError(message, { code: 'enterprise_required', feature });
  }
}

async function assertVolt(userId, feature, message) {
  const { enforced, isVolt } = await getEntitlements(userId);
  if (enforced && !isVolt) throw new EntitlementError(message, { code: 'volt_required', feature });
}

/** Si el error es de permisos del plan, responde y devuelve true. */
function handleEntitlementError(res, err) {
  if (!(err instanceof EntitlementError)) return false;
  res.status(err.status).json(err.body);
  return true;
}

module.exports = {
  ACTIVE_ACTIVITY_LIMIT_PER_COMMUNITY,
  FREE_ACTIVE_ACTIVITY_LIMIT,
  LAUNCH_ACTIVE_ACTIVITY_LIMIT,
  EntitlementError,
  getEntitlements,
  getActiveActivityCount,
  assertCanCreateActivity,
  assertEnterprise,
  assertVolt,
  handleEntitlementError,
};
