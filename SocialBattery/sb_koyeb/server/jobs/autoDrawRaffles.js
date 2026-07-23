const supabase = require('../lib/supabase');
const { drawRaffleWinners, notifyRaffleDrawn } = require('../lib/raffleDraw');
const { notifyUsers } = require('../lib/webpush');

// ─────────────────────────────────────────────────────────────────────────
// Auto-sortear ganadores en cuanto un sorteo alcanza su ends_at
// ─────────────────────────────────────────────────────────────────────────
// Antes de esta fase, el sorteo se ejecutaba SOLO cuando el creador
// pulsaba "🎉 Sortear ganador" en el RaffleCard — y hasta entonces el
// sorteo quedaba con drawn_at = null indefinidamente, aunque la fecha
// hubiese pasado hacía semanas. Muy fácil olvidarlo: los ganadores no
// sabían que habían ganado.
//
// Este cron corre cada minuto, coge todos los sorteos vencidos y sin
// sortear (ends_at <= now AND drawn_at IS NULL), y los ejecuta con la
// misma función que el endpoint manual (lib/raffleDraw.js). El
// endpoint manual sigue vivo — cuando el creador entra al detalle del
// sorteo justo tras el ends_at y aún no ha pasado el minuto del cron,
// puede pulsar "Sortear" y el resultado es el mismo (idempotente
// contra doble llamada porque filtramos drawn_at IS NULL).
//
// Nota sobre elegibles vacíos:
//   - Se calculan los eligibles en el momento del sorteo, no en el de
//     creación (idéntico al endpoint manual: getEligibleRaffleMembers
//     mira el estado ACTUAL de la comunidad).
//   - Si un sorteo se queda sin nadie a quien adjudicar
//     (0 elegibles) el cron lo marca drawn_at IGUALMENTE con premios
//     sin winner_id — mismo comportamiento que un sorteo Light con
//     menos participantes que premios. La alternativa (dejarlo abierto
//     y volver a intentarlo) no encaja: por qué esperar si el sorteo ya
//     venció y no hay pool de dónde sacar más gente. En el legacy
//     (raffle sin filas en community_raffle_prizes) se marca drawn_at
//     sin winner_id — también permite cerrar el sorteo sin premiar a
//     nadie, y el frontend ya trata Boolean(winner) como "hay ganador",
//     no "está sorteado".
//
// El cron NO manda notificaciones push a ganadores por sí mismo —
// eso puede llegar como fase posterior sin tocar este código.
// ─────────────────────────────────────────────────────────────────────────

// Duplico la mecánica de getEligibleRaffleMembers en vez de importarla
// de routes/community.js porque ese fichero es 6000 líneas y sacar UNA
// función pequeña de ahí implica tocar imports y estabilidad de un
// router de express con estado. Cuando alguna otra parte del código
// necesite este helper también, entonces sí toca extraerlo a
// lib/raffleEligibility.js y sustituir en ambos sitios.
async function getEligibleRaffleMembers(communityId, tier) {
  const { data: members, error } = await supabase
    .from('community_members')
    .select('user_id')
    .eq('community_id', communityId)
    .neq('role', 'admin');
  if (error) throw error;
  let userIds = (members || []).map(m => m.user_id);
  if (!userIds.length) return [];

  if (tier === 'volt') {
    const { data: subs, error: subErr } = await supabase
      .from('users')
      .select('id')
      .in('id', userIds)
      .eq('is_volt_subscriber', true);
    if (subErr) throw subErr;
    const subIds = new Set((subs || []).map(u => u.id));
    userIds = userIds.filter(id => subIds.has(id));
  } else if (tier === 'community') {
    const { data: collabs, error: collabErr } = await supabase
      .from('community_collaborations')
      .select('user_id')
      .eq('community_id', communityId);
    if (collabErr) throw collabErr;
    const collabIds = new Set((collabs || []).map(c => c.user_id));
    userIds = userIds.filter(id => collabIds.has(id));
  }
  return userIds;
}

async function runAutoDrawTick() {
  const nowIso = new Date().toISOString();

  // Sorteos vencidos y no sorteados. Se traen batches — si en algún
  // momento se acumula un backlog grande (p.ej. tras un downtime del
  // cron) se procesan en varias vueltas del tick. El .limit acota el
  // peor caso a 200 sorteos por vuelta y evita que un solo tick largo
  // bloquee al siguiente.
  const { data: due, error } = await supabase
    .from('community_raffles')
    .select('id, community_id, creator_id, title, tier')
    .lte('ends_at', nowIso)
    .is('drawn_at', null)
    .limit(200);
  if (error) throw error;
  if (!due || !due.length) return { drawn: 0, failed: 0 };

  let drawn = 0;
  let failed = 0;
  for (const raffle of due) {
    try {
      // getEligibleRaffleMembers falla suave con normalización de tier
      // igual que en routes/community.js: cualquier valor no reconocido
      // cae a 'light'. Suficiente para el cron; el endpoint manual
      // valida más estrictamente antes de llegar a este código.
      const tier = ['light', 'volt', 'community'].includes(raffle.tier) ? raffle.tier : 'light';
      const eligibleIds = await getEligibleRaffleMembers(raffle.community_id, tier);
      await drawRaffleWinners({ raffleId: raffle.id, eligibleIds });
      drawn += 1;

      // Push a los elegibles (excluido el creador). Fire-and-forget: si
      // el push falla no debe interrumpir el batch del cron ni marcar
      // el sorteo como "no sorteado" (ya está persistido en drawn_at).
      // La propia función se traga sus errores, aquí solo blindamos
      // contra excepciones síncronas raras.
      notifyRaffleDrawn(supabase, notifyUsers, {
        raffleId: raffle.id,
        eligibleIds,
        creatorId: raffle.creator_id,
      }).catch(err => console.warn(`[CRON] autoDrawRaffles notif ${raffle.id} failed:`, err.message));
    } catch (err) {
      failed += 1;
      console.error(`[CRON] autoDrawRaffles: sorteo ${raffle.id} falló:`, err.message);
      // Deliberadamente no re-lanzo: un sorteo bug no debe impedir que
      // el resto del batch se procese. drawn_at sigue en null así que
      // el próximo tick lo reintentará solo.
    }
  }
  if (drawn || failed) {
    console.log(`[CRON] autoDrawRaffles: ${drawn} sorteados, ${failed} fallados`);
  }
  return { drawn, failed };
}

module.exports = { runAutoDrawTick };
