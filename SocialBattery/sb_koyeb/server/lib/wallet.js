// ─────────────────────────────────────────────────────────────────────────
// Monedero prepago (ver supabase_schema_phase134_wallet_payments.sql)
// ─────────────────────────────────────────────────────────────────────────
// Toda la aritmética de saldo vive en funciones SQL atómicas (FOR UPDATE);
// aquí solo se llaman y se traducen los errores.
//
// Interruptor PAYMENTS_ENABLED: mientras no valga 'true' las campañas se
// siguen creando gratis como hasta ahora (holdCampaign/chargeFee no hacen
// nada). Así se puede desplegar este código antes de ejecutar la migración
// y de configurar Stripe/Play, y activar el cobro con una sola env var.

const supabase = require('./supabase');
const { FREE_UNITS } = require('./adPricing');

const FREE_CAMPAIGNS_PER_MONTH = 4;

function paymentsEnabled() {
  return String(process.env.PAYMENTS_ENABLED || '').toLowerCase() === 'true';
}

class InsufficientFundsError extends Error {
  constructor(neededCents, balanceCents) {
    super('Saldo insuficiente');
    this.code = 'INSUFFICIENT_FUNDS';
    this.status = 402;
    this.neededCents = neededCents;
    this.balanceCents = balanceCents;
  }
}

function parseRpcError(error) {
  const msg = error?.message || '';
  const m = msg.match(/INSUFFICIENT_FUNDS:(\d+):(\d+)/);
  if (m) return new InsufficientFundsError(Number(m[1]), Number(m[2]));
  return error instanceof Error ? error : new Error(msg || 'wallet error');
}

// Respuesta HTTP estándar para "no te llega el saldo" — el cliente la
// reconoce por code === 'INSUFFICIENT_FUNDS' y ofrece recargar.
function sendInsufficientFunds(res, err) {
  const euros = (c) => (c / 100).toFixed(2).replace('.', ',') + ' €';
  return res.status(402).json({
    code: 'INSUFFICIENT_FUNDS',
    needed_cents: err.neededCents,
    balance_cents: err.balanceCents,
    error: `Saldo insuficiente: esta campaña reserva ${euros(err.neededCents)} y tienes ${euros(err.balanceCents)}. Recarga tu saldo para continuar.`,
  });
}

async function getBalanceCents(userId) {
  const { data, error } = await supabase
    .from('wallets').select('balance_cents').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return Number(data?.balance_cents || 0);
}

function isMissingSchema(error) {
  return /does not exist|schema cache|could not find/i.test(error?.message || '');
}

async function getOpenHold(kind, targetId) {
  const { data, error } = await supabase
    .from('ad_holds')
    .select('id, user_id, amount_cents, unit_price_cents, units_contracted, free_units, extra_unit_price_cents')
    .eq('kind', kind).eq('target_id', targetId).eq('status', 'held')
    .maybeSingle();
  if (error) {
    if (isMissingSchema(error) && !paymentsEnabled()) return null;
    throw error;
  }
  return data || null;
}

// Lo que cobraría wallet_settle_v2 ahora mismo (misma fórmula).
function previewChargeCents(hold, unitsDelivered, extraUnits = 0) {
  if (!hold) return 0;
  const billable = (n) => {
    const delivered = Math.min(Math.max(Math.floor(Number(n) || 0), 0), hold.units_contracted);
    return Math.max(0, delivered - (hold.free_units || 0));
  };
  const charge = billable(unitsDelivered) * hold.unit_price_cents
               + billable(extraUnits) * (hold.extra_unit_price_cents || 0);
  return Math.min(charge, hold.amount_cents);
}

// Lo que devolvería (para comprobar, antes de renovar, si saldo + devolución
// alcanza para la nueva reserva).
function previewRefundCents(hold, unitsDelivered, extraUnits = 0) {
  return hold ? hold.amount_cents - previewChargeCents(hold, unitsDelivered, extraUnits) : 0;
}

// Unidades gratis que le tocan a una campaña: FREE_UNITS en el primer ciclo
// de cada actividad, hasta FREE_CAMPAIGNS_PER_MONTH campañas cada 30 días.
// Sin ese tope bastaría con renovar (o recrear) cada 50 envíos para no pagar.
async function getFreeUnits(userId, kind, targetId = null) {
  if (!paymentsEnabled()) return FREE_UNITS;
  if (targetId) {
    const { count, error } = await supabase
      .from('ad_holds').select('id', { count: 'exact', head: true })
      .eq('kind', kind).eq('target_id', targetId);
    if (error) throw error;
    if (count) return 0;
  }
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from('ad_holds').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).gt('free_units', 0).gte('created_at', since);
  if (error) throw error;
  return (count || 0) >= FREE_CAMPAIGNS_PER_MONTH ? 0 : FREE_UNITS;
}

// Comprueba sin reservar. Lanza InsufficientFundsError.
async function assertCanAfford(userId, neededCents, extraAvailableCents = 0) {
  if (!paymentsEnabled() || neededCents <= 0) return;
  const balance = await getBalanceCents(userId);
  if (balance + extraAvailableCents < neededCents) {
    throw new InsufficientFundsError(neededCents, balance + extraAvailableCents);
  }
}

async function holdCampaign({ userId, kind, targetId, plan, unitPriceCents, units, freeUnits = 0, extraUnitPriceCents = 0 }) {
  if (!paymentsEnabled()) return null;
  if (!units || unitPriceCents + extraUnitPriceCents <= 0) return null;
  const { data, error } = await supabase.rpc('wallet_hold_v2', {
    p_user: userId, p_kind: kind, p_target: targetId, p_plan: plan,
    p_unit_price: unitPriceCents, p_units: units,
    p_free_units: freeUnits, p_extra_unit_price: extraUnitPriceCents,
  });
  if (error) throw parseRpcError(error);
  return data;
}

// Se llama SIEMPRE (aunque PAYMENTS_ENABLED esté apagado) para que las
// reservas hechas mientras estaba encendido se liquiden igual. Sin reserva
// abierta es un no-op.
async function settleCampaign({ kind, targetId, unitsDelivered, extraUnits = 0, reason }) {
  const toInt = (n) => Math.max(0, Math.floor(Number(n) || 0));
  const { data, error } = await supabase.rpc('wallet_settle_v2', {
    p_kind: kind, p_target: targetId,
    p_units_delivered: toInt(unitsDelivered),
    p_extra_units: toInt(extraUnits), p_reason: reason,
  });
  if (error) {
    // Migración sin ejecutar todavía => no hay nada que liquidar.
    if (isMissingSchema(error) && !paymentsEnabled()) return null;
    throw parseRpcError(error);
  }
  if (data?.settled) {
    console.log(`[wallet] settled ${kind} ${targetId} (${reason}): delivered=${toInt(unitsDelivered)}+${toInt(extraUnits)} charged=${data.charged_cents} refunded=${data.refunded_cents}`);
  }
  return data;
}

// Cobrado en el último ciclo, si el cron ya lo había liquidado.
async function lastChargedCents(kind, targetId) {
  const { data } = await supabase
    .from('ad_holds').select('charged_cents')
    .eq('kind', kind).eq('target_id', targetId).eq('status', 'settled')
    .order('created_at', { ascending: false }).limit(1);
  return Number(data?.[0]?.charged_cents || 0);
}

async function chargeFee({ userId, amountCents, description }) {
  if (!paymentsEnabled() || amountCents <= 0) return null;
  const { data, error } = await supabase.rpc('wallet_charge', {
    p_user: userId, p_amount: amountCents, p_description: description,
  });
  if (error) throw parseRpcError(error);
  return data;
}

async function adjust({ userId, amountCents, description }) {
  const { data, error } = await supabase.rpc('wallet_adjust', {
    p_user: userId, p_amount: amountCents, p_description: description,
  });
  if (error) throw parseRpcError(error);
  return data;
}

module.exports = {
  paymentsEnabled,
  InsufficientFundsError,
  sendInsufficientFunds,
  getBalanceCents,
  getOpenHold,
  getFreeUnits,
  previewChargeCents,
  previewRefundCents,
  assertCanAfford,
  holdCampaign,
  settleCampaign,
  lastChargedCents,
  chargeFee,
  adjust,
};
