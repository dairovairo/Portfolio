const supabase = require('./supabase');
const { notifyUsers } = require('./webpush');

// ─────────────────────────────────────────────────────────────────────────
// Notificación push cuando un sorteo se resuelve
// ─────────────────────────────────────────────────────────────────────────
// Se dispara desde dos sitios:
//   · POST /communities/:id/raffles/:raffleId/draw — el creador
//     sortea manualmente antes de que el cron llegue.
//   · jobs/autoDrawRaffles.js — el cron auto-sortea sorteos vencidos.
// Ambos flujos llaman aquí tras persistir los ganadores (ver
// lib/raffleDraw.js) con la lista de eligibleIds que se usó para el
// sorteo.
//
// Se envía UN push a:
//   · Cada ganador — mensaje personalizado con el nombre del premio
//     que ganó. Si un usuario ganó varios (no debería pasar por schema:
//     UNIQUE(raffle_id, winner_id) en community_raffle_prizes evita
//     que la misma persona salga adjudicada dos veces en el mismo
//     sorteo), se coge el de menor position.
//   · Cada no-ganador (elegibles que no ganaron) — mensaje neutral
//     "ya se ha sorteado".
//   · El creador — mensaje informativo separado, útil sobre todo
//     cuando el sorteo lo dispara el cron y no un tap suyo. Los
//     creadores nunca son elegibles (admins excluidos en
//     getEligibleRaffleMembers), así que no doblan mensaje.
//
// Explícitamente NO se pasa por getMuteNewRafflesFilteredIds ni por
// ningún filtro de silenciamiento: es una notificación esencial
// (ganaste/no ganaste tu propio sorteo) que no tiene sentido que el
// usuario silencie. No hay toggle en ajustes para desactivarla.
//
// La URL apunta al detalle del sorteo — mismo patrón que los pushes
// de "nuevo sorteo": /community/<id>?src=raffle_drawn#raffle-<id>.
// El cliente hace scroll al #raffle-<id> igual que ya hace con los
// banners (ver CommunityDetailPage.jsx).
// ─────────────────────────────────────────────────────────────────────────

async function notifyRaffleDrawn({
  raffleId,
  communityId,
  title,
  creatorId,
  eligibleIds = [],
}) {
  try {
    // 1) Ganadores desde la tabla de premios (fase 122). Ordenado por
    //    position para que si un usuario apareciese dos veces (no
    //    debería), coja el premio de mayor rango. Filtramos winner_id
    //    NOT NULL para descartar los "premios sin adjudicar" cuando
    //    había menos elegibles que premios.
    const { data: prizeWinners, error: prizesErr } = await supabase
      .from('community_raffle_prizes')
      .select('title, winner_id, position')
      .eq('raffle_id', raffleId)
      .not('winner_id', 'is', null)
      .order('position', { ascending: true });
    if (prizesErr) throw prizesErr;

    const winnerToPrize = new Map(); // userId → prize title (o null si legacy)

    if (prizeWinners && prizeWinners.length) {
      for (const p of prizeWinners) {
        if (!winnerToPrize.has(p.winner_id)) {
          winnerToPrize.set(p.winner_id, p.title || null);
        }
      }
    } else {
      // 2) Fallback legacy (sorteos pre-fase-122): un solo ganador en
      //    community_raffles.winner_id. No hay título de premio.
      const { data: raffleRow } = await supabase
        .from('community_raffles')
        .select('winner_id')
        .eq('id', raffleId)
        .maybeSingle();
      if (raffleRow?.winner_id) winnerToPrize.set(raffleRow.winner_id, null);
    }

    const winnerIds = [...winnerToPrize.keys()];
    const winnerCount = winnerIds.length;
    const displayTitle = title?.trim() || 'el sorteo';
    const url = `/community/${communityId}?src=raffle_drawn#raffle-${raffleId}`;

    // 3) Push a cada ganador individualmente (mensaje personalizado).
    //    Uso una llamada por ganador porque el body cambia por persona
    //    — notifyUsers agrupa por endpoint pero el mismo payload va a
    //    todos, así que no vale para mensajes distintos.
    //    excludeId=null: no excluimos a nadie (los ganadores nunca son
    //    el creador — admins están fuera del pool de eligibles).
    await Promise.allSettled(winnerIds.map(uid => {
      const prizeName = winnerToPrize.get(uid);
      const body = prizeName
        ? `Has ganado "${prizeName}" en ${displayTitle}`
        : `¡Enhorabuena! Has ganado ${displayTitle}`;
      return notifyUsers(supabase, [uid], null, {
        title: '🎉 ¡Has ganado el sorteo!',
        body,
        url,
        // Tag distinto por usuario+sorteo — si por lo que sea (retry
        // del caller) llega dos veces, el navegador sustituye el push
        // en el tray en vez de acumular dos idénticas.
        tag: `raffle-drawn-winner-${raffleId}-${uid}`,
      });
    }));

    // 4) Push al resto de elegibles — un solo notifyUsers con el mismo
    //    payload para todos (más eficiente: una sola query de subs).
    const nonWinnerIds = eligibleIds.filter(id => !winnerToPrize.has(id) && id !== creatorId);
    if (nonWinnerIds.length) {
      await notifyUsers(supabase, nonWinnerIds, null, {
        title: winnerCount === 1 ? '🎊 Ya hay ganador' : '🎊 Ya hay ganadores',
        body: `Se ha sorteado ${displayTitle}. ¡Descubre quién ha ganado!`,
        url,
        tag: `raffle-drawn-${raffleId}`,
      });
    }

    // 5) Push al creador — misma URL, mensaje diferente porque su
    //    perspectiva es distinta (no participaba, organizaba).
    //    Especialmente útil cuando dispara el cron y no él mismo.
    if (creatorId) {
      await notifyUsers(supabase, [creatorId], null, {
        title: '🎯 Se ha sorteado tu sorteo',
        body: winnerCount === 0
          ? `${displayTitle} se cerró sin ganadores (no había participantes elegibles).`
          : winnerCount === 1
            ? `${displayTitle} ya tiene ganador.`
            : `${displayTitle} ya tiene ${winnerCount} ganadores.`,
        url,
        tag: `raffle-drawn-creator-${raffleId}`,
      });
    }
  } catch (err) {
    console.error('[raffleNotifications] notifyRaffleDrawn error:', err);
    // Nunca re-lanzamos: un fallo de push no debe rebotar el sorteo,
    // que ya está persistido con drawn_at. Los ganadores igual se
    // enteran cuando entren al sorteo.
  }
}

module.exports = { notifyRaffleDrawn };
