// ─────────────────────────────────────────────────────────────────────────
// Sorteos: participantes, publicidad y datos comunes
// ─────────────────────────────────────────────────────────────────────────
// Participar es SIEMPRE gratis. En los sorteos nuevos (requires_entry) hay
// que aceptar las bases y pulsar "Participar"; en los anteriores a la phase
// 135 participan todos los miembros.

const supabase = require('./supabase');
const { fetchAll, selectInChunks, chunk } = require('./paginate');
const { loadAudience, matchesInterests, getCommunityMemberIdSet } = require('./audience');
const { notifyUsers } = require('./webpush');
const { COMMUNITY_RAFFLE_FEE_CENTS } = require('./billingCatalog');

const RAFFLE_TIERS = {
  volt: {
    label: 'Sorteo Volt',
    price_cents: 0,
    rules: 'Participa gratis cualquier miembro de la comunidad. Con suscripción Volt tienes 3 papeletas.',
  },
  community: {
    label: 'Sorteo Community',
    price_cents: COMMUNITY_RAFFLE_FEE_CENTS,
    rules: 'Participa gratis cualquier miembro de la comunidad. Si entre todos se alcanza la meta, se desbloquean los premios extra.',
  },
  light: {
    label: 'Sorteo Light',
    price_cents: null,
    rules: 'Participa gratis cualquier miembro de la comunidad.',
  },
};
const RAFFLE_TIER_KEYS = Object.keys(RAFFLE_TIERS);

const VOLT_MAX_DURATION_DAYS = 14;
const VOLT_MIN_SUBSCRIBERS = 10;
const VOLT_TICKETS = 3;
const VOLT_BANNER_CAP = 1000;
const MIN_ACCOUNT_AGE_HOURS = 48;
const BANNER_VIEWS_MIN = 100;
const BANNER_VIEWS_MAX = 100000;

function normalizeRaffleTier(tier) {
  return RAFFLE_TIERS[tier] ? tier : 'light';
}

/** Categorías con las que se cruzan los intereses: las suyas o, si no tiene, las de la comunidad. */
function effectiveCategories(raffleCategories, communityCategories) {
  const own = (Array.isArray(raffleCategories) ? raffleCategories : []).filter(Boolean);
  return own.length ? own : (communityCategories || []).filter(Boolean);
}

// ── Participantes ────────────────────────────────────────────────────────

/** Miembros que pueden participar: todos menos los admins y el organizador. */
async function getParticipantMemberIds(communityId, creatorId = null) {
  const rows = await fetchAll(() => supabase
    .from('community_members').select('user_id')
    .eq('community_id', communityId).neq('role', 'admin').order('user_id'));
  return rows.map(r => r.user_id).filter(id => id !== creatorId);
}

async function getEntryUserIds(raffleId) {
  const rows = await fetchAll(() => supabase
    .from('raffle_entries').select('user_id').eq('raffle_id', raffleId).order('user_id'));
  return rows.map(r => r.user_id);
}

/** Participantes del sorteo con sus papeletas: [{ userId, tickets }]. */
async function getRaffleParticipants(raffle) {
  let ids = await getParticipantMemberIds(raffle.community_id, raffle.creator_id);
  if (raffle.requires_entry) {
    const entered = new Set(await getEntryUserIds(raffle.id));
    ids = ids.filter(id => entered.has(id));
  }
  if (normalizeRaffleTier(raffle.tier) !== 'volt') return ids.map(userId => ({ userId, tickets: 1 }));

  const subs = new Set((await selectInChunks(ids, part => supabase
    .from('users').select('id').in('id', part).eq('is_volt_subscriber', true).order('id'))).map(u => u.id));
  return ids.map(userId => ({ userId, tickets: subs.has(userId) ? VOLT_TICKETS : 1 }));
}

async function countVoltSubscribers(communityId) {
  const ids = await getParticipantMemberIds(communityId);
  const subs = await selectInChunks(ids, part => supabase
    .from('users').select('id').in('id', part).eq('is_volt_subscriber', true).order('id'));
  return subs.length;
}

/**
 * Datos de participación para pintar una lista de sorteos:
 * Map raffleId → { participantCount, entered, isEligible }.
 */
async function getParticipationInfo(raffles, userId) {
  const info = new Map();
  if (!raffles.length) return info;

  const withEntry = raffles.filter(r => r.requires_entry).map(r => r.id);
  const legacyCommunities = [...new Set(raffles.filter(r => !r.requires_entry).map(r => r.community_id))];

  const [entries, memberships, memberCounts] = await Promise.all([
    selectInChunks(withEntry, ids => supabase
      .from('raffle_entries').select('raffle_id, user_id').in('raffle_id', ids)
      .order('raffle_id').order('user_id')),
    fetchAll(() => supabase.from('community_members').select('community_id, role')
      .eq('user_id', userId).order('community_id')),
    Promise.all(legacyCommunities.map(async communityId => {
      const { count, error } = await supabase
        .from('community_members').select('user_id', { count: 'exact', head: true })
        .eq('community_id', communityId).neq('role', 'admin');
      if (error) throw error;
      return [communityId, count || 0];
    })),
  ]);

  const entryCount = new Map();
  const mine = new Set();
  for (const e of entries) {
    entryCount.set(e.raffle_id, (entryCount.get(e.raffle_id) || 0) + 1);
    if (e.user_id === userId) mine.add(e.raffle_id);
  }
  const roleByCommunity = new Map(memberships.map(m => [m.community_id, m.role]));
  const countByCommunity = new Map(memberCounts);

  for (const r of raffles) {
    const role = roleByCommunity.get(r.community_id);
    const isEligible = Boolean(role) && role !== 'admin' && r.creator_id !== userId;
    info.set(r.id, {
      participantCount: r.requires_entry
        ? entryCount.get(r.id) || 0
        : countByCommunity.get(r.community_id) || 0,
      entered: r.requires_entry ? mine.has(r.id) : isEligible,
      isEligible,
    });
  }
  return info;
}

// ── Meta colectiva ───────────────────────────────────────────────────────

async function getRaisedCents(raffle) {
  const { data, error } = await supabase.rpc('community_raised_cents', {
    p_community_id: raffle.community_id,
    p_from: raffle.created_at,
    p_to: raffle.ends_at,
  });
  if (error) throw error;
  return Number(data) || 0;
}

/** Map raffleId → recaudado, solo de los sorteos con meta. */
async function getRaisedByRaffle(raffles) {
  const withGoal = raffles.filter(r => r.goal_cents);
  return new Map(await Promise.all(withGoal.map(async r => [r.id, await getRaisedCents(r)])));
}

// ── Banners ──────────────────────────────────────────────────────────────

async function countRaffleShown(raffleId) {
  const { count, error } = await supabase
    .from('raffle_banner_targets')
    .select('id', { count: 'exact', head: true })
    .eq('raffle_id', raffleId)
    .not('shown_at', 'is', null);
  if (error) throw error;
  return count || 0;
}

/** raffleId → banners enseñados. */
async function getBannerSentCounts(raffleIds) {
  const counts = {};
  for (const ids of chunk(raffleIds, 20)) {
    await Promise.all(ids.map(async id => { counts[id] = await countRaffleShown(id); }));
  }
  return counts;
}

/** Usuarios a los que puede llegar el banner de un sorteo Light. */
async function getLightAudience({ communityId, creatorId }) {
  const [audience, members] = await Promise.all([loadAudience(), getCommunityMemberIdSet(communityId)]);
  return [...audience.values()].filter(u => u.id !== creatorId && !members.has(u.id) && !u.adFree);
}

/**
 * ¿Se le puede enseñar a este usuario el banner de este sorteo? Los targets
 * se crean al enseñarlo, así que también llega a quien se registre después.
 * @param {object} user  entrada de loadAudience()
 */
function canSeeBanner({ raffle, categories, user, isMember, shown }) {
  if (raffle.creator_id === user.id) return false;
  const tier = normalizeRaffleTier(raffle.tier);
  if (tier === 'community') return isMember;
  if (tier === 'volt') return isMember || (!user.adFree && shown < VOLT_BANNER_CAP);
  return !isMember && !user.adFree
    && shown < (raffle.banner_views_contracted || 0)
    && (!raffle.banner_interested_only || matchesInterests(user, categories));
}

/** Marca el banner como enseñado. false si ya se le había enseñado. */
async function claimBannerShown(raffleId, userId, matchedInterest) {
  const shownAt = new Date().toISOString();
  const { data: inserted, error } = await supabase
    .from('raffle_banner_targets')
    .upsert(
      { raffle_id: raffleId, user_id: userId, shown_at: shownAt, matched_interest: matchedInterest },
      { onConflict: 'raffle_id,user_id', ignoreDuplicates: true })
    .select('id');
  if (error) throw error;
  if (inserted?.length) return true;
  // Ya tenía target asignado (miembros): solo cuenta si no se le había enseñado.
  const { data: updated, error: updateError } = await supabase
    .from('raffle_banner_targets')
    .update({ shown_at: shownAt })
    .eq('raffle_id', raffleId).eq('user_id', userId).is('shown_at', null)
    .select('id');
  if (updateError) throw updateError;
  return Boolean(updated?.length);
}

/**
 * Publica el sorteo entre los miembros: aviso dentro de la app y push (con
 * cualquier tipo de sorteo) y, en Volt y Community, su target del banner.
 */
async function announceRaffle({ raffle, communityName, categories }) {
  const tier = normalizeRaffleTier(raffle.tier);
  const members = [...await getCommunityMemberIdSet(raffle.community_id)]
    .filter(id => id !== raffle.creator_id);
  if (!members.length) return;

  if (tier !== 'light') {
    const audience = await loadAudience();
    for (const ids of chunk(members, 500)) {
      const { error } = await supabase.from('raffle_banner_targets').upsert(
        ids.map(id => ({
          raffle_id: raffle.id,
          user_id: id,
          matched_interest: categories.length && audience.has(id)
            ? matchesInterests(audience.get(id), categories) : null,
        })),
        { onConflict: 'raffle_id,user_id', ignoreDuplicates: true });
      if (error) console.warn('[raffles] targets de miembros:', error.message);
    }
  }

  const muted = new Set((await selectInChunks(members, ids => supabase
    .from('users').select('id').in('id', ids).eq('mute_new_raffles', true).order('id'))).map(u => u.id));
  const recipients = members.filter(id => !muted.has(id));
  if (!recipients.length) return;

  const payload = {
    raffle_id: raffle.id,
    community_id: raffle.community_id,
    community_name: communityName,
    creator_id: raffle.creator_id,
    title: raffle.title,
    tier,
  };
  for (const ids of chunk(recipients, 50)) {
    await Promise.allSettled(ids.map(id => supabase
      .channel(`raffle-banner-notif-${id}`)
      .send({ type: 'broadcast', event: 'new_raffle_banner', payload })));
  }

  // ?src=raffle: marca de atribución del click (fase 111).
  await notifyUsers(supabase, recipients, raffle.creator_id, {
    title: `🎉 Nuevo sorteo en ${communityName || 'tu comunidad'}`,
    body: raffle.title || 'Se ha creado un nuevo sorteo',
    url: `/community/${raffle.community_id}?src=raffle#raffle-${raffle.id}`,
    tag: `raffle-banner-${raffle.id}`,
  });
}

module.exports = {
  RAFFLE_TIERS,
  RAFFLE_TIER_KEYS,
  VOLT_MAX_DURATION_DAYS,
  VOLT_MIN_SUBSCRIBERS,
  VOLT_TICKETS,
  VOLT_BANNER_CAP,
  MIN_ACCOUNT_AGE_HOURS,
  BANNER_VIEWS_MIN,
  BANNER_VIEWS_MAX,
  normalizeRaffleTier,
  effectiveCategories,
  getParticipantMemberIds,
  getRaffleParticipants,
  countVoltSubscribers,
  getParticipationInfo,
  getRaisedCents,
  getRaisedByRaffle,
  countRaffleShown,
  getBannerSentCounts,
  getLightAudience,
  canSeeBanner,
  claimBannerShown,
  announceRaffle,
};
