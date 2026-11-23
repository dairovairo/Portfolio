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

async function getOpenHold(kind, targetId) {
  const { data, error } = await supabase
    .from('ad_holds')
    .select('id, user_id, amount_cents, unit_price_cents, units_contracted')
    .eq('kind', kind).eq('target_id', targetId).eq('status', 'held')
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

// Lo que devolvería wallet_settle ahora mismo (para comprobar, antes de
// renovar, si saldo + devolución alcanza para la nueva reserva).
function previewRefundCents(hold, unitsDelivered, threshold) {
  if (!hold) return 0;
  const charge = unitsDelivered >= threshold
    ? Math.min(Math.max(unitsDelivered, 0), hold.units_contracted) * hold.unit_price_cents
    : 0;
  return Math.max(0, hold.amount_cents - Math.min(charge, hold.amount_cents));
}

// Comprueba sin reservar. Lanza InsufficientFundsError.
async function assertCanAfford(userId, neededCents, extraAvailableCents = 0) {
  if (!paymentsEnabled() || neededCents <= 0) return;
  const balance = await getBalanceCents(userId);
  if (balance + extraAvailableCents < neededCents) {
    throw new InsufficientFundsError(neededCents, balance + extraAvailableCents);
  }
}

async function holdCampaign({ userId, kind, targetId, plan, unitPriceCents, units }) {
  if (!paymentsEnabled()) return null;
  const amount = unitPriceCents * units;
  if (amount <= 0) return null;
  const { data, error } = await supabase.rpc('wallet_hold', {
    p_user: userId, p_kind: kind, p_target: targetId, p_plan: plan,
    p_unit_price: unitPriceCents, p_units: units,
  });
  if (error) throw parseRpcError(error);
  return data;
}

// Se llama SIEMPRE (aunque PAYMENTS_ENABLED esté apagado) para que las
// reservas hechas mientras estaba encendido se liquiden igual. Sin reserva
// abierta es un no-op.
async function settleCampaign({ kind, targetId, unitsDelivered, threshold, reason }) {
  const { data, error } = await supabase.rpc('wallet_settle', {
    p_kind: kind, p_target: targetId,
    p_units_delivered: Math.max(0, Math.floor(Number(unitsDelivered) || 0)),
    p_threshold: threshold, p_reason: reason,
  });
  if (error) {
    // Migración sin ejecutar todavía => no hay nada que liquidar.
    if (/wallet_settle|does not exist|schema cache/i.test(error.message || '') && !paymentsEnabled()) return null;
    throw parseRpcError(error);
  }
  if (data?.settled) {
    console.log(`[wallet] settled ${kind} ${targetId} (${reason}): delivered=${unitsDelivered} charged=${data.charged_cents} refunded=${data.refunded_cents}`);
  }
  return data;
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
  previewRefundCents,
  assertCanAfford,
  holdCampaign,
  settleCampaign,
  chargeFee,
  adjust,
};
