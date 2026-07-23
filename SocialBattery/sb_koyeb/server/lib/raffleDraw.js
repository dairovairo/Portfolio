const supabase = require('./supabase');

// ─────────────────────────────────────────────────────────────────────────
// Ejecución del sorteo — extraído del endpoint manual para poder
// reutilizarlo desde el cron de auto-sorteo (jobs/autoDrawRaffles.js).
// ─────────────────────────────────────────────────────────────────────────
// Contrato: recibe raffle + elegibles YA cargados por el caller (así
// tanto el endpoint como el cron reutilizan sus propios fetches sin
// repetir consultas). Aplica una de estas dos ramas:
//
//   · Con premios en la tabla community_raffle_prizes (fase 122):
//     Fisher-Yates parcial para min(N premios, N elegibles) ganadores
//     sin reemplazo; premio i-ésimo por posición para el i-ésimo
//     extraído. Actualiza cada premio con su winner_id, y luego
//     community_raffles.drawn_at.
//
//   · Sin premios (raffle legacy pre-fase-122):
//     Un único ganador aleatorio guardado en community_raffles.winner_id
//     junto con drawn_at, para no romper sorteos antiguos que aún viven
//     en la base de datos.
//
// El caller decide si permitir "sortear sin elegibles suficientes"
// (el endpoint manual devuelve 400 si eligibles.length === 0; el cron
// también lo salta) porque son decisiones de política, no del sorteo
// en sí. Aquí simplemente si no hay ninguno se marca drawn_at igual
// (sorteo cerrado sin adjudicaciones) — el caller decide si llegar
// aquí o no.
//
// Devuelve el nuevo estado del sorteo (misma fila con drawn_at seteado)
// para que el caller pueda reserializar la respuesta sin re-fetch.
async function drawRaffleWinners({ raffleId, eligibleIds }) {
  const { data: prizeRows, error: prizesFetchErr } = await supabase
    .from('community_raffle_prizes')
    .select('id, position')
    .eq('raffle_id', raffleId)
    .order('position', { ascending: true });
  if (prizesFetchErr) throw prizesFetchErr;

  const nowIso = new Date().toISOString();

  if (!prizeRows || prizeRows.length === 0) {
    // ── Camino legacy (raffle sin premios en la tabla nueva) ──
    // Con lista vacía de elegibles se marca drawn_at sin winner —
    // impide que se vuelva a intentar y deja claro que "hubo intento
    // pero no había a quién asignar".
    const patch = { drawn_at: nowIso };
    if (eligibleIds.length) {
      patch.winner_id = eligibleIds[Math.floor(Math.random() * eligibleIds.length)];
    }
    const { error: updateErr } = await supabase
      .from('community_raffles')
      .update(patch)
      .eq('id', raffleId);
    if (updateErr) throw updateErr;
    return { prizesDrawn: eligibleIds.length ? 1 : 0, totalPrizes: 0 };
  }

  // ── Camino de premios (fase 122) ──
  // Fisher-Yates parcial: baraja los primeros K = min(nº premios,
  // nº elegibles) elementos y toma esos K como ganadores en orden. El
  // primer extraído se lleva el premio position=1, el segundo el 2,
  // etc. Si sobran premios respecto a elegibles, quedan sin winner
  // (permitido por schema: winner_id NULL). No se re-sortea ni se rota:
  // drawn_at queda seteado y este flujo no debe llamarse de nuevo
  // (idempotencia recae en el caller vía "drawn_at IS NULL" al filtrar).
  const shuffled = eligibleIds.slice();
  const draws = Math.min(prizeRows.length, shuffled.length);
  for (let i = 0; i < draws; i++) {
    const j = i + Math.floor(Math.random() * (shuffled.length - i));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  // Actualiza cada premio con su ganador en secuencia (batch upsert no
  // encaja bien con el schema "una fila por id" con gen_random_uuid).
  // Son pocas rows en cualquier caso (PRIZE_MAX_PER_RAFFLE = 10).
  for (let i = 0; i < draws; i++) {
    const { error: prizeUpdateErr } = await supabase
      .from('community_raffle_prizes')
      .update({ winner_id: shuffled[i] })
      .eq('id', prizeRows[i].id);
    if (prizeUpdateErr) throw prizeUpdateErr;
  }
  const { error: raffleUpdateErr } = await supabase
    .from('community_raffles')
    .update({ drawn_at: nowIso })
    .eq('id', raffleId);
  if (raffleUpdateErr) throw raffleUpdateErr;

  return { prizesDrawn: draws, totalPrizes: prizeRows.length };
}

// ─────────────────────────────────────────────────────────────────────────
// Notificación push de "sorteo terminado" (fase de auto-draw)
// ─────────────────────────────────────────────────────────────────────────
// Se manda a todos los usuarios que eran ELEGIBLES para participar
// (mismo criterio que usa el propio sorteo), excluyendo al creador —
// que ya sabe que se ha sorteado y quiere que su push no le llegue a sí
// mismo. Se dispara tanto desde POST /raffles/:id/draw como desde el
// cron autoDrawRaffles.js, para que la única forma de que alguien no la
// reciba sea que sencillamente no tenga push activo en el navegador.
// Deliberadamente NO se consulta ninguna tabla de mute (mute_new_events,
// mute_new_recommendations, muted_conversations…): es una notificación
// transaccional de "algo en lo que participabas ya tiene resultado",
// y silenciarla dejaría a un ganador sin enterarse de su premio. No hay
// toggle en ajustes para esto — decisión de producto.
//
// La lib de webpush (notifyUsers) llega inyectada por el caller para no
// forzar acoplamiento desde este fichero, que era puro hasta ahora.
// `tag` en el payload garantiza que si por algún race el mismo push
// entra dos veces al navegador, solo se pinte una notificación.
//
// URL destino: se aprovecha el patrón `/community/:id#raffle-:id` que ya
// usan las tarjetas compactas del dashboard (CommunityDashboardPage →
// RaffleCardCompact → onOpen). Al aterrizar en la comunidad, el sorteo
// aparece en la lista con sus ganadores adjudicados por premio (los
// ganadores ven su nombre destacado como 🏆).
async function notifyRaffleDrawn(supabase, notifyUsers, { raffleId, eligibleIds, creatorId }) {
  if (!eligibleIds || !eligibleIds.length) return;
  try {
    const { data: raffle, error } = await supabase
      .from('community_raffles')
      .select('id, title, community_id, community:communities!community_raffles_community_id_fkey(name)')
      .eq('id', raffleId)
      .maybeSingle();
    if (error) throw error;
    if (!raffle) return;
    const commName = raffle.community?.name;
    await notifyUsers(supabase, eligibleIds, creatorId, {
      title: '🎁 Sorteo terminado',
      body: commName
        ? `Ya se han sorteado los premios de "${raffle.title}" en ${commName}.`
        : `Ya se han sorteado los premios de "${raffle.title}".`,
      url: `/community/${raffle.community_id}#raffle-${raffleId}`,
      tag: `raffle-drawn-${raffleId}`,
    });
  } catch (err) {
    // Un fallo del push NUNCA debe revertir el sorteo — los premios ya
    // están adjudicados. Se loguea y se sigue.
    console.warn('[raffleDraw] notifyRaffleDrawn failed:', err.message);
  }
}

module.exports = { drawRaffleWinners, notifyRaffleDrawn };
