const supabase = require('./supabase');

const CIRCLE_BADGES = [
  {
    // El id se mantiene igual que siempre ('lone_wolf') aunque el nombre
    // visible cambie a "Couch Potato" — mismo espíritu de sobra (quien
    // menos aprovecha las quedadas a las que podría unirse), solo cambia
    // cómo se llama. Igual que se hizo con "tapado" → "Average Joe/Jane"
    // en la fase 62: el id no se toca para no romper las filas ya
    // existentes en user_badges.
    // Emoji: 🥔 (patata) en vez de 🛋️ (sofá+lámpara) — el sofá renderiza
    // muy a color/vistoso comparado con el resto de iconos del catálogo,
    // más apagados; la patata mantiene el juego de palabras y es más sobria.
    //
    // Criterio (cambiado en esta fase): antes era el recuento crudo de
    // quedadas ajenas unidas (quien se apuntaba a menos, ganaba). Ahora
    // es un RATIO: quedadas a las que se ha unido / quedadas a las que
    // ha sido invitado. "Invitado" = misma visibilidad que usa el feed
    // de quedadas (GET /pools, ver routes/pools.js): la quedada es
    // pública y la creó alguien del ámbito, o pertenece a un grupo del
    // que el usuario es miembro, o tiene invitación explícita
    // (pool_invitees). Así no penaliza a quien simplemente ve pocas
    // quedadas (bajo joinedPools crudo) sino a quien, viendo muchas
    // oportunidades, se apunta a pocas.
    id: 'lone_wolf',
    name: 'Couch Potato',
    emoji: '🥔',
    description: 'Quien menos aprovecha las quedadas a las que le invitan.',
    category: 'circle',
  },
  {
    // "Lone Wolf" pasa a significar otra cosa: ya no es sobre quedadas,
    // sino sobre amistades — el que menos amigos tiene en la app. Id
    // nuevo porque es un criterio distinto al que tenía antes ese nombre.
    id: 'few_friends',
    name: 'Lone Wolf',
    emoji: '🐺',
    description: 'Quien menos amigos tiene en la app.',
    category: 'circle',
  },
  {
    id: 'people_magnet',
    name: 'People Magnet',
    emoji: '🧲',
    description: 'Quien mas amigos tiene en la app.',
    category: 'circle',
  },
  {
    id: 'last_one_standing',
    name: 'Last One Standing',
    emoji: '🧍',
    description: 'Quien mas quedadas termina solo, sin que nadie mas se una.',
    category: 'circle',
  },
  {
    // Ventana horaria 22:00-05:59 (antes 22:00-01:59) y solo se mira
    // el historial de los últimos 30 días (antes 90) — cambiado en esta
    // fase para que la insignia refleje el hábito reciente, no un
    // acumulado de hace tres meses.
    id: 'night_owl',
    name: 'Night Owl',
    emoji: '🦉',
    description: 'Quien mantiene mas bateria social por la noche.',
    category: 'circle',
  },
  {
    // Mismo criterio de siempre (quien mas pools crea), solo cambia el
    // nombre visible — igual que con "lone_wolf" de arriba, el id se
    // mantiene para no romper el historial ya persistido en user_badges.
    id: 'instigator',
    name: 'Connector',
    emoji: '🔥',
    description: 'Quien mas quedadas crea dentro del circulo.',
    category: 'circle',
  },
  {
    id: 'last_minute_joiner',
    name: 'Last Minute Joiner',
    // Sin el selector de presentación a color (U+FE0F): igual que el resto
    // de símbolos de línea del proyecto (🔓︎/🔒︎/⚙︎, ver .sb-symbol en
    // index.css), este glifo por defecto ya es de línea/monocromo — el
    // FE0F que tenía antes lo forzaba a un estopwatch a color, desentonando
    // con el resto del catálogo de insignias.
    emoji: '⏱',
    // Criterio (cambiado en esta fase): antes era el recuento crudo de
    // veces siendo el último en apuntarse. Ahora es un RATIO sobre las
    // quedadas finalizadas en las que ha participado como invitado (no
    // como organizador, igual que el propio recuento nunca contaba al
    // creador): veces que fue el último / quedadas finalizadas en las
    // que ha estado apuntado. Evita que gane solo por estar en muchas
    // quedadas — ahora hace falta que sea un patrón, no solo volumen.
    description: 'Quien mas veces entra ultimo a una quedada, de las que ha estado apuntado.',
    category: 'circle',
  },
  {
    // Criterio (cambiado en esta fase): mismo tipo de ratio que
    // Last Minute Joiner pero mirando quién se apunta PRIMERO: veces
    // que fue el primero / quedadas finalizadas en las que ha estado
    // apuntado (como invitado, no como organizador).
    id: 'early_joiner',
    name: 'Early Joiner',
    emoji: '🥇',
    description: 'Quien mas veces es el primero en apuntarse, de las que ha estado apuntado.',
    category: 'circle',
  },
  {
    // Ventana horaria 06:00-11:59 (antes 06:00-09:59) y 30 días de
    // historial (antes 90), mismo motivo y misma fuente de datos
    // (battery_history) que Night Owl — comparten la única consulta.
    id: 'early_bird',
    name: 'Early Bird',
    emoji: '🌅',
    description: 'Quien tiene mas bateria social por la manana.',
    category: 'circle',
  },
  {
    // A diferencia de "last_minute_joiner" (que mira el orden de
    // apuntarse online), esta mira la llegada física a la quedada según
    // los check-ins del modo Sniffer ("Estoy dentro").
    //
    // Criterio (cambiado en esta fase): antes era el recuento crudo de
    // veces llegando el último (de los que llegan). Ahora es un RATIO:
    // veces que llega el último / veces que ha estado presente (total
    // de check-ins confirmados). A diferencia de Last Minute/Early
    // Joiner, aquí SÍ puede competir el creador — llegar tarde a tu
    // propia quedada también cuenta, igual que antes.
    id: 'late_legend',
    name: 'Late Legend',
    emoji: '🐢',
    description: 'Quien mas veces llega el ultimo, de las veces que ha estado presente.',
    category: 'circle',
  },
  {
    // Ratio de quedadas a las que se apunta pero no confirma llegada
    // (sin check-in de Sniffer) sobre el total de quedadas finalizadas
    // a las que se apuntó.
    id: 'ghost',
    name: 'Ghost',
    emoji: '👻',
    description: 'Quien mas se apunta a quedadas y menos se presenta.',
    category: 'circle',
  },
  {
    id: 'tapado',
    name: 'Average Joe/Jane',
    emoji: '🫥',
    description: 'Sin insignia... el mas normal de tus colegas.',
    category: 'circle',
    exclusive: false,   // a diferencia del resto, esta la pueden tener varias personas a la vez
  },
];

const TAPADO_BADGE_ID = 'tapado';

const BADGE_BY_ID = Object.fromEntries(CIRCLE_BADGES.map(badge => [badge.id, badge]));
const MAX_IDENTITIES_PER_USER = 1;

async function getCircleMemberIds(userId) {
  const { data: friendships, error } = await supabase
    .from('friendships')
    .select('requester_id, addressee_id')
    .eq('status', 'accepted')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);

  if (error) throw error;

  const ids = new Set([userId]);
  (friendships || []).forEach(friendship => {
    ids.add(friendship.requester_id === userId ? friendship.addressee_id : friendship.requester_id);
  });
  return [...ids];
}

async function getGroupMemberIds(groupId) {
  const { data, error } = await supabase
    .from('friend_group_members')
    .select('user_id')
    .eq('group_id', groupId);

  if (error) throw error;
  return (data || []).map(row => row.user_id);
}

// Apuntados de una quedada concreta (participantes + quien la creó).
async function getPoolParticipantIds(poolId) {
  const { data: pool, error: poolError } = await supabase
    .from('hangout_pools')
    .select('creator_id')
    .eq('id', poolId)
    .maybeSingle();
  if (poolError) throw poolError;

  const { data, error } = await supabase
    .from('pool_participants')
    .select('user_id')
    .eq('pool_id', poolId);
  if (error) throw error;

  const ids = new Set((data || []).map(row => row.user_id));
  if (pool?.creator_id) ids.add(pool.creator_id);
  return [...ids];
}

function createStats(memberIds) {
  return Object.fromEntries(memberIds.map(userId => [userId, {
    userId,
    joinedPools: 0,
    createdPools: 0,
    soloFinishedPools: 0,
    lastMinuteJoins: 0,
    earlyJoins: 0,
    lateArrivals: 0,
    noShows: 0,
    joinedFinishedPools: 0,
    // Fase de ratios — nuevos denominadores:
    //   · invitedPools — quedadas ajenas a las que ha sido invitado
    //     (visibilidad pública/grupo/invitación explícita), usado por
    //     el ratio de Couch Potato.
    //   · joinedFinishedAsGuest — quedadas YA FINALIZADAS a las que se
    //     apuntó como invitado (no como organizador), denominador de
    //     Last Minute Joiner y Early Joiner.
    //   · checkinsCount — veces que ha confirmado llegada física
    //     (check-in de Sniffer) en quedadas finalizadas, denominador
    //     de Late Legend.
    invitedPools: 0,
    joinedFinishedAsGuest: 0,
    checkinsCount: 0,
    friendCount: 0,
    nightTotal: 0,
    nightCount: 0,
    morningTotal: 0,
    morningCount: 0,
  }]));
}

function average(total, count) {
  return count > 0 ? total / count : null;
}

function scoreText(value, suffix = '') {
  if (value === null || value === undefined) return 'sin datos';
  if (Number.isInteger(value)) return `${value}${suffix}`;
  return `${Math.round(value)}${suffix}`;
}

function stableTieValue(...parts) {
  const text = parts.filter(Boolean).join(':');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function scoreRank(statsList, metric, value, higherIsBetter = true) {
  return statsList.filter(stats =>
    higherIsBetter ? stats[metric] > value : stats[metric] < value
  ).length + 1;
}

function pushHighCandidates(candidates, badgeId, statsList, metric, minScore, reasonFactory) {
  const ranked = statsList
    .filter(stats => stats[metric] >= minScore)
    .sort((a, b) => b[metric] - a[metric] || a.userId.localeCompare(b.userId));

  ranked.forEach((stats, index) => {
    const next = ranked.find((candidate, nextIndex) =>
      nextIndex > index && candidate[metric] !== stats[metric]
    );
    const gap = next ? stats[metric] - next[metric] : stats[metric];
    candidates.push({
      badgeId,
      userId: stats.userId,
      score: stats[metric],
      sortScore: stats[metric],
      strength: Math.max(0, gap),
      rank: scoreRank(ranked, metric, stats[metric]),
      reason: reasonFactory(stats),
    });
  });
}

// `higherIsBetter` permite reutilizar el mismo patrón de ratio tanto
// para "cuanto más alto, gana" (night_owl, early_bird, ghost, late_legend,
// last_minute_joiner, early_joiner) como para "cuanto más bajo, gana"
// (lone_wolf/Couch Potato: menos ratio unidas/invitado = más couch potato).
// El desempate SIEMPRE favorece a quien tiene más volumen de datos
// (countKey más alto) antes de cualquier otro criterio — con esto una
// persona con 1/1 (100%) no le gana automáticamente a alguien con 9/10
// (90%) si el ratio exacto empata tras redondeo, y sobre todo evita que
// "strength" (usado para desempatar en chooseAssignments) favorezca
// datos anecdóticos.
function pushAverageCandidates(candidates, badgeId, statsList, totalKey, countKey, reasonFactory, { higherIsBetter = true } = {}) {
  const ranked = statsList
    .map(stats => ({
      ...stats,
      average: average(stats[totalKey], stats[countKey]),
    }))
    .filter(stats => stats.average !== null)
    .sort((a, b) =>
      (higherIsBetter ? b.average - a.average : a.average - b.average) ||
      b[countKey] - a[countKey] ||
      a.userId.localeCompare(b.userId)
    );

  ranked.forEach((stats, index) => {
    const next = ranked.find((candidate, nextIndex) =>
      nextIndex > index && candidate.average !== stats.average
    );
    const gap = next ? Math.abs(stats.average - next.average) : Math.abs(stats.average);
    candidates.push({
      badgeId,
      userId: stats.userId,
      score: stats.average,
      sortScore: higherIsBetter ? stats.average : -stats.average,
      strength: Math.max(0, gap) + (stats[countKey] * 0.01),
      rank: higherIsBetter
        ? ranked.filter(candidate => candidate.average > stats.average).length + 1
        : ranked.filter(candidate => candidate.average < stats.average).length + 1,
      reason: reasonFactory(stats),
    });
  });
}

// Generaliza el patrón de "quien tiene el valor MAS BAJO de una métrica"
// (antes solo existía para lone_wolf/joinedPools; ahora también lo usa
// few_friends/friendCount). Requiere que al menos alguien tenga un valor
// > 0 en la métrica para poder repartir la insignia (si todo el mundo
// está a 0, no hay nada que premiar/señalar).
function pushLowCandidates(candidates, badgeId, statsList, metric, reasonFactory, tieBreakMetric = null) {
  const hasSignal = statsList.some(stats => stats[metric] > 0);
  if (!hasSignal) return;

  const ranked = [...statsList].sort((a, b) =>
    a[metric] - b[metric] ||
    (tieBreakMetric ? a[tieBreakMetric] - b[tieBreakMetric] : 0) ||
    a.userId.localeCompare(b.userId)
  );

  ranked.forEach((stats, index) => {
    const next = ranked.find((candidate, nextIndex) =>
      nextIndex > index && candidate[metric] !== stats[metric]
    );
    const gap = next ? next[metric] - stats[metric] : Math.max(1, statsList.length);
    candidates.push({
      badgeId,
      userId: stats.userId,
      score: stats[metric],
      sortScore: -stats[metric],
      strength: Math.max(0, gap),
      rank: scoreRank(ranked, metric, stats[metric], false),
      reason: reasonFactory(stats),
    });
  });
}

/**
 * Asigna insignias con las siguientes reglas:
 * - Una insignia solo puede tenerla UNA persona (exclusiva por grupo)
 * - Una persona puede tener como maximo UNA identidad activa a la vez
 * - Si varias personas empatan en puntuacion para una insignia,
 *   tiene prioridad quien no tenga ya una identidad activa
 * - "Tapado" es la excepcion: no compite por puntuacion, sino que se
 *   asigna automaticamente a cualquier miembro que no haya ganado
 *   ninguna otra insignia. A diferencia del resto, la pueden tener
 *   varias personas del grupo a la vez.
 */
function chooseAssignments(candidates, memberIds, scopeId = 'circle') {
  const assignments = [];
  const assignedBadges = new Set();
  const userBadgeCount = {};

  const competitiveBadges = CIRCLE_BADGES.filter(badge => badge.id !== TAPADO_BADGE_ID);

  // Procesamos cada insignia competitiva en el orden definido en CIRCLE_BADGES
  for (const badgeDef of competitiveBadges) {
    const badgeId = badgeDef.id;
    const badgeCandidates = candidates.filter(c =>
      c.badgeId === badgeId &&
      (userBadgeCount[c.userId] || 0) < MAX_IDENTITIES_PER_USER
    );
    if (!badgeCandidates.length) continue;
    if (assignedBadges.has(badgeId)) continue;

    const bestScore = Math.max(...badgeCandidates.map(c => c.sortScore ?? c.score ?? 0));
    const topCandidates = badgeCandidates.filter(c => (c.sortScore ?? c.score ?? 0) === bestScore);
    const fewestIdentities = Math.min(...topCandidates.map(c => userBadgeCount[c.userId] || 0));
    const balancedCandidates = topCandidates.filter(c => (userBadgeCount[c.userId] || 0) === fewestIdentities);
    const winner = [...balancedCandidates].sort((a, b) =>
      stableTieValue(scopeId, badgeId, a.userId) - stableTieValue(scopeId, badgeId, b.userId)
    )[0];
    assignments.push({
      ...winner,
      badge: BADGE_BY_ID[badgeId],
      earned_at: new Date().toISOString(),
    });
    assignedBadges.add(badgeId);
    userBadgeCount[winner.userId] = (userBadgeCount[winner.userId] || 0) + 1;
  }

  // "Tapado": red de seguridad para quien no haya ganado ninguna insignia
  // competitiva. No exclusiva — todos los que apliquen la reciben a la vez.
  const wonUserIds = new Set(assignments.map(a => a.userId));
  const tapadoBadge = BADGE_BY_ID[TAPADO_BADGE_ID];
  memberIds.forEach(userId => {
    if (wonUserIds.has(userId)) return;
    assignments.push({
      badgeId: TAPADO_BADGE_ID,
      userId,
      score: 0,
      sortScore: 0,
      strength: 0,
      rank: 1,
      reason: 'Sin insignia en este grupo... el mas normal de tus colegas.',
      badge: tapadoBadge,
      earned_at: new Date().toISOString(),
    });
  });

  return assignments;
}

/**
 * Calcula estadísticas y candidatos para una lista de miembros.
 * Reutilizable tanto por computeCircleBadges como computeGroupBadges.
 */
async function computeBadgesForMembers(memberIds, options = {}) {
  const { data: members, error: membersError } = await supabase
    .from('users')
    .select('id, username, avatar_url, battery_level')
    .in('id', memberIds);
  if (membersError) throw membersError;

  const statsByUser = createStats(memberIds);

  let poolsQuery = supabase
    .from('hangout_pools')
    // is_public y group_id se necesitan para calcular invitedPools (a
    // quién se considera "invitado" a cada quedada, ver bloque más abajo).
    .select('id, creator_id, scheduled_at, status, created_at, is_public, group_id')
    .in('creator_id', memberIds)
    .neq('status', 'cancelled');

  if (options.groupId) {
    poolsQuery = poolsQuery.eq('group_id', options.groupId);
  }

  const { data: pools, error: poolsError } = await poolsQuery;
  if (poolsError) throw poolsError;

  const poolIds = (pools || []).map(pool => pool.id);
  let participants = [];
  if (poolIds.length) {
    const { data, error } = await supabase
      .from('pool_participants')
      .select('pool_id, user_id, joined_at')
      .in('pool_id', poolIds);
    if (error) throw error;
    participants = data || [];
  }

  const participantsByPool = new Map();
  participants.forEach(participant => {
    if (!participantsByPool.has(participant.pool_id)) participantsByPool.set(participant.pool_id, []);
    participantsByPool.get(participant.pool_id).push(participant);
  });

  const now = new Date();
  (pools || []).forEach(pool => {
    const creatorStats = statsByUser[pool.creator_id];
    if (!creatorStats) return;

    creatorStats.createdPools += 1;

    const poolParticipants = participantsByPool.get(pool.id) || [];
    poolParticipants.forEach(participant => {
      const participantStats = statsByUser[participant.user_id];
      if (participantStats && participant.user_id !== pool.creator_id) {
        participantStats.joinedPools += 1;
      }
    });

    const isFinished = pool.status === 'closed' || new Date(pool.scheduled_at) <= now;
    if (!isFinished) return;

    if (poolParticipants.length === 1 && poolParticipants[0].user_id === pool.creator_id) {
      creatorStats.soloFinishedPools += 1;
    }

    // Participantes (excluyendo al creador) de esta quedada YA
    // FINALIZADA. Se reutiliza para lastMinuteJoins/earlyJoins (según
    // orden de joined_at) y como denominador de sus ratios:
    // joinedFinishedAsGuest = cuántas quedadas finalizadas ha "vivido"
    // como invitado, no como organizador (mismo criterio de exclusión
    // que ya tenían ambas insignias: el creador no compite por
    // "último/primero en apuntarse" porque su plaza es automática).
    const guestParticipants = poolParticipants.filter(participant => participant.user_id !== pool.creator_id);
    guestParticipants.forEach(participant => {
      const stats = statsByUser[participant.user_id];
      if (stats) stats.joinedFinishedAsGuest += 1;
    });

    const lateCandidates = [...guestParticipants].sort((a, b) => new Date(b.joined_at) - new Date(a.joined_at));
    const lastJoiner = lateCandidates[0];
    if (lastJoiner && statsByUser[lastJoiner.user_id]) {
      statsByUser[lastJoiner.user_id].lastMinuteJoins += 1;
    }

    // Simétrico a lastMinuteJoiner pero mirando quién se apuntó ANTES
    // (menor joined_at) — mismo conjunto guestParticipants, solo cambia
    // el orden de ordenación.
    const earlyCandidates = [...guestParticipants].sort((a, b) => new Date(a.joined_at) - new Date(b.joined_at));
    const firstJoiner = earlyCandidates[0];
    if (firstJoiner && statsByUser[firstJoiner.user_id]) {
      statsByUser[firstJoiner.user_id].earlyJoins += 1;
    }

    // "Ghost" y "Late Legend" necesitan saber quién de los apuntados
    // (incluido el creador, que también puede no presentarse a su propia
    // quedada) confirmó su llegada física con el check-in de Sniffer
    // ("Estoy dentro"). Se calcula más abajo una vez tenemos todos los
    // check-ins de golpe (una sola query fuera de este bucle).
    poolParticipants.forEach(participant => {
      const stats = statsByUser[participant.user_id];
      if (stats) stats.joinedFinishedPools += 1;
    });
  });

  // Check-ins del modo Sniffer ("Estoy dentro") para las quedadas ya
  // finalizadas de arriba — sirven tanto para "Ghost" (se apunta y no
  // llega) como para "Late Legend" (de los que sí llegan, quién llega
  // el último más veces).
  let checkins = [];
  if (poolIds.length) {
    const { data, error } = await supabase
      .from('pool_sniffer_checkins')
      .select('pool_id, user_id, checked_in_at')
      .in('pool_id', poolIds);
    if (error) throw error;
    checkins = data || [];
  }

  const checkinsByPool = new Map();
  checkins.forEach(checkin => {
    if (!checkinsByPool.has(checkin.pool_id)) checkinsByPool.set(checkin.pool_id, []);
    checkinsByPool.get(checkin.pool_id).push(checkin);
  });

  const finishedPoolIds = new Set(
    (pools || [])
      .filter(pool => pool.status === 'closed' || new Date(pool.scheduled_at) <= now)
      .map(pool => pool.id)
  );

  finishedPoolIds.forEach(poolId => {
    const poolParticipants = participantsByPool.get(poolId) || [];
    const poolCheckins = checkinsByPool.get(poolId) || [];
    const checkedInUserIds = new Set(poolCheckins.map(c => c.user_id));

    // Ghost: apuntado a una quedada ya finalizada sin check-in de llegada.
    poolParticipants.forEach(participant => {
      if (checkedInUserIds.has(participant.user_id)) return;
      const stats = statsByUser[participant.user_id];
      if (stats) stats.noShows += 1;
    });

    // checkinsCount: veces que ha confirmado llegada física — denominador
    // del ratio de Late Legend ("de las veces que has estado presente,
    // cuántas llegaste el último"). Incluye al creador si también hizo
    // check-in, igual que lateArrivals más abajo puede premiarlo a él.
    poolCheckins.forEach(checkin => {
      const stats = statsByUser[checkin.user_id];
      if (stats) stats.checkinsCount += 1;
    });

    // Late Legend: de los que SÍ llegaron, quién confirmó más tarde.
    const lastArrival = [...poolCheckins].sort(
      (a, b) => new Date(b.checked_in_at) - new Date(a.checked_in_at)
    )[0];
    if (lastArrival && statsByUser[lastArrival.user_id]) {
      statsByUser[lastArrival.user_id].lateArrivals += 1;
    }
  });

  // ── "Invitado" a una quedada ajena — denominador de Couch Potato ────────
  // Mismo criterio de visibilidad que usa el feed de quedadas
  // (GET /pools, filtro 'active', ver routes/pools.js): estás invitado
  // a una quedada ajena si es pública (visible dentro del ámbito), si
  // perteneces al grupo al que está vinculada, o si tienes invitación
  // explícita (pool_invitees) — esta última cubre también las
  // solicitudes de invitación aceptadas (pool_join_requests), que al
  // aprobarse insertan la fila en pool_invitees igualmente.
  //
  // El propio creador nunca cuenta como "invitado" a su propia quedada
  // (no te invitas a ti mismo) — coherente con que joinedPools tampoco
  // cuenta las quedadas propias.
  const { data: inviteeRows, error: inviteesError } = poolIds.length
    ? await supabase.from('pool_invitees').select('pool_id, user_id').in('pool_id', poolIds)
    : { data: [], error: null };
  if (inviteesError) throw inviteesError;
  const inviteesByPool = new Map();
  (inviteeRows || []).forEach(row => {
    if (!inviteesByPool.has(row.pool_id)) inviteesByPool.set(row.pool_id, new Set());
    inviteesByPool.get(row.pool_id).add(row.user_id);
  });

  // Membresía de grupo para los grupos referenciados por las quedadas
  // en juego. Cuando el cómputo ya está acotado a un groupId (fase
  // computeGroupBadges), todas las quedadas comparten ese mismo grupo y
  // memberIds YA ES la membresía — pero se resuelve igual de forma
  // genérica para que funcione también en el círculo completo o en el
  // ámbito de una quedada concreta, donde las quedadas de por medio
  // pueden pertenecer a distintos grupos.
  const distinctGroupIds = [...new Set((pools || []).map(pool => pool.group_id).filter(Boolean))];
  const groupMembersByGroup = new Map();
  if (distinctGroupIds.length) {
    const { data: groupMemberRows, error: groupMembersError } = await supabase
      .from('friend_group_members')
      .select('group_id, user_id')
      .in('group_id', distinctGroupIds)
      .in('user_id', memberIds);
    if (groupMembersError) throw groupMembersError;
    (groupMemberRows || []).forEach(row => {
      if (!groupMembersByGroup.has(row.group_id)) groupMembersByGroup.set(row.group_id, new Set());
      groupMembersByGroup.get(row.group_id).add(row.user_id);
    });
  }

  (pools || []).forEach(pool => {
    let audience;
    if (pool.is_public) {
      // Pública: visible a todo el mundo del ámbito (dentro del círculo
      // o grupo ya estamos asumiendo que son amigos/compañeros de grupo).
      audience = new Set(memberIds);
    } else {
      audience = new Set([...(inviteesByPool.get(pool.id) || [])].filter(id => statsByUser[id]));
      if (pool.group_id && groupMembersByGroup.has(pool.group_id)) {
        groupMembersByGroup.get(pool.group_id).forEach(uid => audience.add(uid));
      }
    }
    audience.delete(pool.creator_id);
    audience.forEach(uid => {
      const stats = statsByUser[uid];
      if (stats) stats.invitedPools += 1;
    });
  });

  // Amigos totales en la app (no solo dentro de este grupo/quedada) —
  // usado por "People Magnet" y por el nuevo criterio de "Lone Wolf".
  const { data: friendRows, error: friendError } = await supabase
    .from('friendships')
    .select('requester_id, addressee_id')
    .eq('status', 'accepted')
    .or(`requester_id.in.(${memberIds.join(',')}),addressee_id.in.(${memberIds.join(',')})`);
  if (friendError) throw friendError;

  (friendRows || []).forEach(row => {
    if (statsByUser[row.requester_id]) statsByUser[row.requester_id].friendCount += 1;
    if (statsByUser[row.addressee_id]) statsByUser[row.addressee_id].friendCount += 1;
  });

  // Ventana de 30 días (antes 90) — refleja el hábito reciente, no un
  // acumulado de tres meses. Comparten esta única consulta Night Owl y
  // Early Bird.
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const { data: history, error: historyError } = await supabase
    .from('battery_history')
    .select('user_id, level, hour, recorded_at')
    .in('user_id', memberIds)
    .gte('recorded_at', since.toISOString());
  if (historyError) throw historyError;

  (history || []).forEach(entry => {
    const stats = statsByUser[entry.user_id];
    if (!stats) return;

    // Night Owl: 22:00-05:59 (antes 22:00-01:59).
    if (entry.hour >= 22 || entry.hour < 6) {
      stats.nightTotal += entry.level;
      stats.nightCount += 1;
    }
    // Early Bird: 06:00-11:59 (antes 06:00-09:59).
    if (entry.hour >= 6 && entry.hour < 12) {
      stats.morningTotal += entry.level;
      stats.morningCount += 1;
    }
  });

  const statsList = Object.values(statsByUser);
  const candidates = [];

  // Couch Potato: ratio joinedPools/invitedPools, cuanto MÁS BAJO gana
  // (aprovecha menos las invitaciones que recibe). El desempate por
  // volumen ya lo aplica pushAverageCandidates (countKey=invitedPools).
  pushAverageCandidates(
    candidates,
    'lone_wolf', // Couch Potato — mismo id de siempre, ver comentario en CIRCLE_BADGES
    statsList,
    'joinedPools',
    'invitedPools',
    stats => `${stats.joinedPools}/${stats.invitedPools} invitaciones aprovechadas`,
    { higherIsBetter: false }
  );
  pushLowCandidates(
    candidates,
    'few_friends', // Lone Wolf — criterio nuevo, ver comentario en CIRCLE_BADGES
    statsList,
    'friendCount',
    stats => `${stats.friendCount} amigos en la app`
  );
  pushHighCandidates(
    candidates,
    'people_magnet',
    statsList,
    'friendCount',
    1,
    stats => `${stats.friendCount} amigos en la app`
  );
  pushHighCandidates(
    candidates,
    'last_one_standing',
    statsList,
    'soloFinishedPools',
    1,
    stats => `${stats.soloFinishedPools} quedadas terminadas solo`
  );
  pushAverageCandidates(
    candidates,
    'night_owl',
    statsList,
    'nightTotal',
    'nightCount',
    stats => `${scoreText(stats.average, '%')} de media nocturna (${stats.nightCount} registros)`
  );
  pushHighCandidates(
    candidates,
    'instigator', // Connector — mismo id de siempre, ver comentario en CIRCLE_BADGES
    statsList,
    'createdPools',
    1,
    stats => `${stats.createdPools} quedadas creadas`
  );
  // Last Minute Joiner: ratio lastMinuteJoins/joinedFinishedAsGuest,
  // cuanto MÁS ALTO gana (patrón recurrente, no solo volumen).
  pushAverageCandidates(
    candidates,
    'last_minute_joiner',
    statsList,
    'lastMinuteJoins',
    'joinedFinishedAsGuest',
    stats => `${stats.lastMinuteJoins}/${stats.joinedFinishedAsGuest} veces el ultimo en apuntarse`
  );
  // Early Joiner: mismo patrón que arriba, mirando "primero" en vez de
  // "último".
  pushAverageCandidates(
    candidates,
    'early_joiner',
    statsList,
    'earlyJoins',
    'joinedFinishedAsGuest',
    stats => `${stats.earlyJoins}/${stats.joinedFinishedAsGuest} veces el primero en apuntarse`
  );
  pushAverageCandidates(
    candidates,
    'early_bird',
    statsList,
    'morningTotal',
    'morningCount',
    stats => `${scoreText(stats.average, '%')} de media por la manana (${stats.morningCount} registros)`
  );
  // Late Legend: ratio lateArrivals/checkinsCount — de las veces que ha
  // estado presente (check-in confirmado), cuántas llegó el último.
  pushAverageCandidates(
    candidates,
    'late_legend',
    statsList,
    'lateArrivals',
    'checkinsCount',
    stats => `${stats.lateArrivals}/${stats.checkinsCount} veces el ultimo en llegar`
  );
  pushAverageCandidates(
    candidates,
    'ghost',
    statsList,
    'noShows',
    'joinedFinishedPools',
    stats => `${stats.noShows}/${stats.joinedFinishedPools} quedadas sin presentarse`
  );

  const assignments = chooseAssignments(candidates, memberIds, options.scopeId || options.groupId || memberIds.join('|'));
  const membersById = Object.fromEntries((members || []).map(member => [member.id, member]));

  return {
    badges: CIRCLE_BADGES,
    members: members || [],
    assignments: assignments.map(assignment => ({
      ...assignment,
      user: membersById[assignment.userId] || { id: assignment.userId },
    })),
    stats: Object.fromEntries(Object.entries(statsByUser).map(([userId, stats]) => [userId, {
      ...stats,
      nightAverage: average(stats.nightTotal, stats.nightCount),
      morningAverage: average(stats.morningTotal, stats.morningCount),
    }])),
  };
}

/**
 * Calcula las insignias para un grupo privado de amigos.
 * Las insignias ganadas se persisten permanentemente en user_badges.
 * Devuelve las asignaciones actuales (dinámicas) del grupo.
 */
async function computeGroupBadges(groupId) {
  const memberIds = await getGroupMemberIds(groupId);
  if (!memberIds.length) return { badges: CIRCLE_BADGES, members: [], assignments: [], stats: {} };

  const result = await computeBadgesForMembers(memberIds, { groupId, scopeId: groupId });

  // Persistir insignias ganadas de forma permanente en user_badges
  // (usando upsert; si ya la tiene, no cambia nada — es la primera vez que cuenta)
  if (result.assignments.length) {
    const rows = result.assignments.map(a => ({
      user_id: a.userId,
      badge_id: a.badgeId,
      earned_at: a.earned_at,
    }));
    await supabase
      .from('user_badges')
      .upsert(rows, { onConflict: 'user_id,badge_id', ignoreDuplicates: true });
  }

  return result;
}

/**
 * Calcula las insignias para los apuntados de una quedada (pool) concreta.
 * Mismo criterio que computeGroupBadges (misma competición, misma
 * persistencia permanente en user_badges) pero el conjunto de miembros es
 * el de los apuntados a esa quedada en vez de los de un grupo privado, y
 * las estadísticas se calculan a nivel de círculo (sin restringir por
 * group_id) ya que una quedada no agrupa varias quedadas propias.
 */
async function computePoolBadges(poolId) {
  const memberIds = await getPoolParticipantIds(poolId);
  if (!memberIds.length) return { badges: CIRCLE_BADGES, members: [], assignments: [], stats: {} };

  const result = await computeBadgesForMembers(memberIds, { scopeId: `pool:${poolId}` });

  if (result.assignments.length) {
    const rows = result.assignments.map(a => ({
      user_id: a.userId,
      badge_id: a.badgeId,
      earned_at: a.earned_at,
    }));
    await supabase
      .from('user_badges')
      .upsert(rows, { onConflict: 'user_id,badge_id', ignoreDuplicates: true });
  }

  return result;
}

/**
 * Calcula las insignias para el círculo completo de amigos aceptados del usuario.
 * Mantenido por compatibilidad con rutas existentes.
 */
async function computeCircleBadges(viewerId) {
  const memberIds = await getCircleMemberIds(viewerId);
  return computeBadgesForMembers(memberIds, { scopeId: `circle:${viewerId}` });
}

module.exports = {
  CIRCLE_BADGES,
  computeCircleBadges,
  computeGroupBadges,
  computePoolBadges,
};
