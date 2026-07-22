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

module.exports = { drawRaffleWinners };
