// ─────────────────────────────────────────────────────────────────────────
// Promoción gratis (pagos apagados)
// ─────────────────────────────────────────────────────────────────────────
// Sin pagos, promocionar eventos y sorteos no cuesta nada. El tope es por
// CUENTA, no por comunidad: si fuera por comunidad bastaría con crear más.
// La comprobación definitiva es atómica en SQL (free_promo_launch, phase 136).
//
// reserve()/assertCanLaunch() son la puerta única que usan las rutas: con
// pagos encendidos reservan saldo; apagados, gastan una campaña gratis.

const supabase = require('./supabase');
const wallet = require('./wallet');

const MAX_UNITS = 500;       // avisos o banners por campaña
const MAX_ACTIVE = 2;        // campañas a la vez
const MAX_PER_MONTH = 4;     // campañas (incluye renovar) cada 30 días
const MONTH_MS = 30 * 24 * 3600 * 1000;

class FreePromoLimitError extends Error {
  constructor(reason, nextAt = null) {
    const when = nextAt
      ? ` Podrás lanzar otra el ${new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'long' }).format(new Date(nextAt))}.` : '';
    super(reason === 'active'
      ? `Ya tienes ${MAX_ACTIVE} promociones activas. Espera a que acabe alguna o finalízala.`
      : `Ya has usado tus ${MAX_PER_MONTH} promociones gratis de los últimos 30 días.${when}`);
    this.code = 'FREE_PROMO_LIMIT';
    this.status = 429;
    this.reason = reason;
    this.nextAt = nextAt;
  }
}

/** Cuándo se libera un hueco: caduca la más antigua de las que cuentan. */
function nextSlotAt(launchDates, now = Date.now()) {
  const recent = launchDates
    .map(d => new Date(d).getTime())
    .filter(ms => ms > now - MONTH_MS)
    .sort((a, b) => b - a);
  if (recent.length < MAX_PER_MONTH) return null;
  return new Date(recent[MAX_PER_MONTH - 1] + MONTH_MS).toISOString();
}

/** Estado de la cuota de una cuenta. null si los pagos están encendidos. */
async function getStatus(userId, targetId = null) {
  if (wallet.paymentsEnabled()) return null;
  const [launches, active] = await Promise.all([
    supabase.from('free_promo_launches').select('created_at')
      .eq('user_id', userId)
      .gt('created_at', new Date(Date.now() - MONTH_MS).toISOString())
      .order('created_at', { ascending: false }),
    supabase.rpc('free_promo_active_count', { p_user: userId, p_exclude: targetId }),
  ]);
  if (launches.error) throw launches.error;
  if (active.error) throw active.error;

  const used = (launches.data || []).length;
  const activeCount = Number(active.data) || 0;
  const nextAt = nextSlotAt((launches.data || []).map(l => l.created_at));
  const blocked = nextAt ? 'month' : activeCount >= MAX_ACTIVE ? 'active' : null;
  return {
    max_units: MAX_UNITS,
    max_active: MAX_ACTIVE,
    max_per_month: MAX_PER_MONTH,
    active: activeCount,
    used,
    remaining: Math.max(0, MAX_PER_MONTH - used),
    next_at: nextAt,
    blocked,
  };
}

/** Comprueba, sin gastar nada, que se puede lanzar la campaña. */
async function assertCanLaunch({ userId, amountCents, targetId = null, creditCents = 0 }) {
  if (wallet.paymentsEnabled()) return wallet.assertCanAfford(userId, amountCents, creditCents);
  const status = await getStatus(userId, targetId);
  if (status.blocked) throw new FreePromoLimitError(status.blocked, status.next_at);
  return undefined;
}

/** Reserva el saldo (pagos) o gasta una campaña gratis. */
async function reserve({ userId, targetId, hold }) {
  if (wallet.paymentsEnabled()) return wallet.holdCampaign({ ...hold, userId, targetId });
  const { error } = await supabase.rpc('free_promo_launch', {
    p_user: userId, p_kind: hold.kind, p_target: targetId, p_units: hold.units,
    p_max_active: MAX_ACTIVE, p_max_month: MAX_PER_MONTH,
  });
  if (!error) return null;
  const limit = /FREE_PROMO_LIMIT:(\w+)/.exec(error.message || '');
  if (limit) throw new FreePromoLimitError(limit[1]);
  throw error;
}

/** Cantidad que se puede contratar: sin pagos hay un máximo por campaña. */
function capUnits(units) {
  return wallet.paymentsEnabled() ? units : Math.min(units, MAX_UNITS);
}

function handleLimitError(res, err) {
  if (!(err instanceof FreePromoLimitError)) return false;
  res.status(err.status).json({ code: err.code, reason: err.reason, next_at: err.nextAt, error: err.message });
  return true;
}

module.exports = {
  MAX_UNITS,
  MAX_ACTIVE,
  MAX_PER_MONTH,
  FreePromoLimitError,
  nextSlotAt,
  getStatus,
  assertCanLaunch,
  reserve,
  capUnits,
  handleLimitError,
};
