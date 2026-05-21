const supabase = require('./supabase');

const CIRCLE_BADGES = [
  {
    id: 'lone_wolf',
    name: 'Lone Wolf',
    emoji: '🐺',
    description: 'Quien menos se apunta a quedadas dentro del circulo.',
    category: 'circle',
  },
  {
    id: 'last_one_standing',
    name: 'Last One Standing',
    emoji: '🧍',
    description: 'Quien mas pools termina solo, sin que nadie mas se una.',
    category: 'circle',
  },
  {
    id: 'night_owl',
    name: 'Night Owl',
    emoji: '🦉',
    description: 'Quien mantiene mas bateria social por la noche.',
    category: 'circle',
  },
  {
    id: 'instigator',
    name: 'Instigator',
    emoji: '🔥',
    description: 'Quien mas pools crea dentro del circulo.',
    category: 'circle',
  },
  {
    id: 'last_minute_joiner',
    name: 'Last Minute Joiner',
    emoji: '⏱️',
    description: 'Quien mas veces entra ultimo a un pool antes de que se cierre.',
    category: 'circle',
  },
  {
    id: 'early_bird',
    name: 'Early Bird',
    emoji: '🌅',
    description: 'Quien tiene mas bateria social por la manana.',
    category: 'circle',
  },
];

const BADGE_BY_ID = Object.fromEntries(CIRCLE_BADGES.map(badge => [badge.id, badge]));

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

function createStats(memberIds) {
  return Object.fromEntries(memberIds.map(userId => [userId, {
    userId,
    joinedPools: 0,
    createdPools: 0,
    soloFinishedPools: 0,
    lastMinuteJoins: 0,
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

function pushHighCandidates(candidates, badgeId, statsList, metric, minScore, reasonFactory) {
  const ranked = statsList
    .filter(stats => stats[metric] >= minScore)
    .sort((a, b) => b[metric] - a[metric] || a.userId.localeCompare(b.userId));

  ranked.forEach((stats, index) => {
    const next = ranked[index + 1];
    const gap = next ? stats[metric] - next[metric] : stats[metric];
    if (gap <= 0 && index === 0) return;
    candidates.push({
      badgeId,
      userId: stats.userId,
      score: stats[metric],
      strength: gap,
      rank: index + 1,
      reason: reasonFactory(stats),
    });
  });
}

function pushAverageCandidates(candidates, badgeId, statsList, totalKey, countKey, reasonFactory) {
  const ranked = statsList
    .map(stats => ({
      ...stats,
      average: average(stats[totalKey], stats[countKey]),
    }))
    .filter(stats => stats.average !== null)
    .sort((a, b) => b.average - a.average || b[countKey] - a[countKey] || a.userId.localeCompare(b.userId));

  ranked.forEach((stats, index) => {
    const next = ranked[index + 1];
    const gap = next ? stats.average - next.average : stats.average;
    if (gap <= 0 && index === 0) return;
    candidates.push({
      badgeId,
      userId: stats.userId,
      score: stats.average,
      strength: gap + (stats[countKey] * 0.01),
      rank: index + 1,
      reason: reasonFactory(stats),
    });
  });
}

function pushLoneWolfCandidates(candidates, statsList) {
  const activeCircle = statsList.some(stats => stats.joinedPools > 0);
  if (!activeCircle) return;

  const ranked = [...statsList].sort((a, b) =>
    a.joinedPools - b.joinedPools || a.createdPools - b.createdPools || a.userId.localeCompare(b.userId)
  );

  ranked.forEach((stats, index) => {
    const next = ranked[index + 1];
    const gap = next ? next.joinedPools - stats.joinedPools : Math.max(1, statsList.length);
    if (gap <= 0 && index === 0) return;
    candidates.push({
      badgeId: 'lone_wolf',
      userId: stats.userId,
      score: stats.joinedPools,
      strength: gap,
      rank: index + 1,
      reason: `${stats.joinedPools} quedadas ajenas unidas`,
    });
  });
}

function chooseAssignments(candidates) {
  const assignments = [];
  const assignedBadges = new Set();
  const assignedUsers = new Set();

  const sorted = [...candidates].sort((a, b) =>
    b.strength - a.strength ||
    b.score - a.score ||
    a.rank - b.rank ||
    a.badgeId.localeCompare(b.badgeId)
  );

  sorted.forEach(candidate => {
    if (assignedBadges.has(candidate.badgeId)) return;
    if (assignedUsers.has(candidate.userId)) return;

    assignments.push({
      ...candidate,
      badge: BADGE_BY_ID[candidate.badgeId],
      earned_at: new Date().toISOString(),
    });
    assignedBadges.add(candidate.badgeId);
    assignedUsers.add(candidate.userId);
  });

  return assignments.sort((a, b) => CIRCLE_BADGES.findIndex(badge => badge.id === a.badgeId) - CIRCLE_BADGES.findIndex(badge => badge.id === b.badgeId));
}

async function computeCircleBadges(viewerId) {
  const memberIds = await getCircleMemberIds(viewerId);

  const { data: members, error: membersError } = await supabase
    .from('users')
    .select('id, username, display_name, avatar_url, battery_level')
    .in('id', memberIds);
  if (membersError) throw membersError;

  const statsByUser = createStats(memberIds);

  const { data: pools, error: poolsError } = await supabase
    .from('hangout_pools')
    .select('id, creator_id, scheduled_at, status, created_at')
    .in('creator_id', memberIds)
    .neq('status', 'cancelled');
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

    const lateCandidates = poolParticipants
      .filter(participant => participant.user_id !== pool.creator_id)
      .sort((a, b) => new Date(b.joined_at) - new Date(a.joined_at));
    const lastJoiner = lateCandidates[0];
    if (lastJoiner && statsByUser[lastJoiner.user_id]) {
      statsByUser[lastJoiner.user_id].lastMinuteJoins += 1;
    }
  });

  const since = new Date();
  since.setDate(since.getDate() - 90);

  const { data: history, error: historyError } = await supabase
    .from('battery_history')
    .select('user_id, level, hour, recorded_at')
    .in('user_id', memberIds)
    .gte('recorded_at', since.toISOString());
  if (historyError) throw historyError;

  (history || []).forEach(entry => {
    const stats = statsByUser[entry.user_id];
    if (!stats) return;

    if (entry.hour >= 22 || entry.hour < 2) {
      stats.nightTotal += entry.level;
      stats.nightCount += 1;
    }
    if (entry.hour >= 6 && entry.hour < 10) {
      stats.morningTotal += entry.level;
      stats.morningCount += 1;
    }
  });

  const statsList = Object.values(statsByUser);
  const candidates = [];

  pushLoneWolfCandidates(candidates, statsList);
  pushHighCandidates(
    candidates,
    'last_one_standing',
    statsList,
    'soloFinishedPools',
    1,
    stats => `${stats.soloFinishedPools} pools terminados solo`
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
    'instigator',
    statsList,
    'createdPools',
    1,
    stats => `${stats.createdPools} pools creados`
  );
  pushHighCandidates(
    candidates,
    'last_minute_joiner',
    statsList,
    'lastMinuteJoins',
    1,
    stats => `${stats.lastMinuteJoins} ultimas entradas`
  );
  pushAverageCandidates(
    candidates,
    'early_bird',
    statsList,
    'morningTotal',
    'morningCount',
    stats => `${scoreText(stats.average, '%')} de media por la manana (${stats.morningCount} registros)`
  );

  const assignments = chooseAssignments(candidates);
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

module.exports = {
  CIRCLE_BADGES,
  computeCircleBadges,
};
