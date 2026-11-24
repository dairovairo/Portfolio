// ─────────────────────────────────────────────────────────────────────────
// Ejecución del sorteo
// ─────────────────────────────────────────────────────────────────────────
// Lo usan el botón "Sortear" y el cron (jobs/autoDrawRaffles.js).
//
// Verificable: al crear el sorteo se genera una semilla secreta y se publica
// su sha256 (draw_commit). Al sortear se revela la semilla y con ella y la
// lista de participantes (claves anónimas, ver entryKey) cualquiera puede
// repetir el cálculo. El organizador no puede elegir el resultado.

const crypto = require('crypto');
const supabase = require('./supabase');
const { getRaffleParticipants, getRaisedCents } = require('./raffles');

const CLAIM_DAYS = 14;

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

function createDrawSecret() {
  const seed = crypto.randomBytes(32).toString('hex');
  return { seed, commit: sha256(seed) };
}

/** Identificador anónimo de un participante en un sorteo concreto. */
const entryKey = (raffleId, userId) => sha256(`${raffleId}:${userId}`);

/** Número pseudoaleatorio en [0, total) derivado de la semilla. */
function drawNumber(seed, label, total) {
  const hex = crypto.createHmac('sha256', seed).update(label).digest('hex');
  return Number(BigInt(`0x${hex}`) % BigInt(total));
}

/**
 * Elige ganadores distintos, con peso por papeletas. Determinista: mismos
 * datos → mismo resultado.
 * @param {Array<{ key: string, tickets: number }>} entries
 * @returns {string[]} claves ganadoras, en orden de premio
 */
function pickWinners({ seed, raffleId, entries, count, label = '' }) {
  const pool = [...entries].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const winners = [];
  for (let i = 0; i < count && pool.length; i += 1) {
    const total = pool.reduce((sum, e) => sum + e.tickets, 0);
    let n = drawNumber(seed, `${raffleId}:${label}${i}`, total);
    const index = pool.findIndex(e => { n -= e.tickets; return n < 0; });
    winners.push(pool[index].key);
    pool.splice(index, 1);
  }
  return winners;
}

async function getOrCreateSecret(raffle) {
  const { data, error } = await supabase
    .from('raffle_draw_secrets').select('seed').eq('raffle_id', raffle.id).maybeSingle();
  if (error) throw error;
  if (data?.seed) return { seed: data.seed, commit: raffle.draw_commit || sha256(data.seed) };
  const secret = createDrawSecret(); // sorteos anteriores a la phase 135
  const { error: insertError } = await supabase
    .from('raffle_draw_secrets').upsert({ raffle_id: raffle.id, seed: secret.seed });
  if (insertError) throw insertError;
  return secret;
}

const RAFFLE_COLUMNS = 'id, community_id, creator_id, title, tier, created_at, ends_at, drawn_at, requires_entry, goal_cents, draw_commit';

function claimDeadline(now = new Date()) {
  return new Date(now.getTime() + CLAIM_DAYS * 24 * 3600 * 1000).toISOString();
}

/**
 * Sortea. Devuelve null si ya estaba sorteado (o lo está sorteando otra
 * instancia): el UPDATE con drawn_at IS NULL solo lo gana uno.
 */
async function drawRaffle(raffleId) {
  const now = new Date();
  const { data: raffle, error: claimError } = await supabase
    .from('community_raffles')
    .update({ drawn_at: now.toISOString() })
    .eq('id', raffleId).is('drawn_at', null)
    .select(RAFFLE_COLUMNS)
    .maybeSingle();
  if (claimError) throw claimError;
  if (!raffle) return null;

  try {
    const [participants, prizesRes, secret, raised] = await Promise.all([
      getRaffleParticipants(raffle),
      supabase.from('community_raffle_prizes')
        .select('id, position, requires_goal').eq('raffle_id', raffleId).order('position'),
      getOrCreateSecret(raffle),
      raffle.goal_cents ? getRaisedCents(raffle) : 0,
    ]);
    if (prizesRes.error) throw prizesRes.error;

    const goalReached = !raffle.goal_cents || raised >= raffle.goal_cents;
    const prizes = (prizesRes.data || []).filter(p => goalReached || !p.requires_goal);
    const userByKey = new Map(participants.map(p => [entryKey(raffleId, p.userId), p.userId]));
    const entries = participants.map(p => ({ key: entryKey(raffleId, p.userId), tickets: p.tickets }));
    const isLegacy = !(prizesRes.data || []).length;
    const winners = pickWinners({
      seed: secret.seed, raffleId, entries, count: isLegacy ? 1 : prizes.length,
    }).map(key => userByKey.get(key));

    const { error: snapshotError } = await supabase
      .from('raffle_draw_secrets')
      .update({ entries: participants.map(p => ({ u: p.userId, t: p.tickets })) })
      .eq('raffle_id', raffleId);
    if (snapshotError) throw snapshotError;

    for (let i = 0; !isLegacy && i < winners.length; i += 1) {
      const { error } = await supabase
        .from('community_raffle_prizes')
        .update({ winner_id: winners[i], claim_status: 'pending', claim_deadline: claimDeadline(now) })
        .eq('id', prizes[i].id);
      if (error) throw error;
    }

    const { error: finishError } = await supabase
      .from('community_raffles')
      .update({
        draw_commit: secret.commit,
        draw_seed: secret.seed,
        draw_entries: participants.length,
        ...(isLegacy && winners[0] ? { winner_id: winners[0] } : {}),
      })
      .eq('id', raffleId);
    if (finishError) throw finishError;

    return { raffle, participantIds: participants.map(p => p.userId), winners, goalReached, raised };
  } catch (err) {
    // Se deshace para que el siguiente intento empiece de cero.
    await supabase.from('community_raffle_prizes')
      .update({ winner_id: null, claim_status: null, claim_deadline: null }).eq('raffle_id', raffleId);
    await supabase.from('community_raffles').update({ drawn_at: null }).eq('id', raffleId);
    throw err;
  }
}

/** Vuelve a sortear un premio que su ganador no ha reclamado a tiempo. */
async function redrawPrize(prize) {
  const [{ data: secret, error }, { data: siblings, error: sibError }] = await Promise.all([
    supabase.from('raffle_draw_secrets').select('seed, entries').eq('raffle_id', prize.raffle_id).maybeSingle(),
    supabase.from('community_raffle_prizes').select('winner_id').eq('raffle_id', prize.raffle_id),
  ]);
  if (error || sibError) throw (error || sibError);

  const previous = [...(prize.previous_winners || []), prize.winner_id].filter(Boolean);
  const excluded = new Set([...previous, ...(siblings || []).map(s => s.winner_id)]);
  const candidates = (secret?.entries || []).filter(e => !excluded.has(e.u));
  const userByKey = new Map(candidates.map(e => [entryKey(prize.raffle_id, e.u), e.u]));
  const [winnerKey] = secret ? pickWinners({
    seed: secret.seed,
    raffleId: prize.raffle_id,
    entries: candidates.map(e => ({ key: entryKey(prize.raffle_id, e.u), tickets: e.t })),
    count: 1,
    label: `redraw:${prize.position}:${previous.length}:`,
  }) : [];
  const winnerId = userByKey.get(winnerKey) || null;

  const { data: updated, error: updateError } = await supabase
    .from('community_raffle_prizes')
    .update({
      winner_id: winnerId,
      previous_winners: previous,
      claim_status: winnerId ? 'pending' : null,
      claim_deadline: winnerId ? claimDeadline() : null,
    })
    .eq('id', prize.id).eq('claim_status', 'pending').eq('winner_id', prize.winner_id)
    .select('id').maybeSingle();
  if (updateError) throw updateError;
  return updated ? { winnerId } : null;
}

/** Datos públicos para comprobar el sorteo (claves anónimas, no usuarios). */
async function getVerification(raffleId) {
  const { data, error } = await supabase
    .from('raffle_draw_secrets').select('entries').eq('raffle_id', raffleId).maybeSingle();
  if (error) throw error;
  return (data?.entries || [])
    .map(e => ({ key: entryKey(raffleId, e.u), tickets: e.t }))
    .sort((a, b) => (a.key < b.key ? -1 : 1));
}

module.exports = {
  CLAIM_DAYS,
  createDrawSecret,
  entryKey,
  pickWinners,
  drawRaffle,
  redrawPrize,
  getVerification,
};
