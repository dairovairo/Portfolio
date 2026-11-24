// ─────────────────────────────────────────────────────────────────────────
// Audiencia publicitaria
// ─────────────────────────────────────────────────────────────────────────
// Única definición de "a quién se le puede enseñar publicidad". La usan el
// reparto de push (jobs/eventPromoPacing.js), los banners y los contadores de
// la pantalla de contratar, para que el número que ve el organizador sea el
// que después se puede entregar de verdad.

const supabase = require('./supabase');
const { fetchAll } = require('./paginate');
const { haversineKm } = require('./homeLocation');

const CACHE_MS = 60 * 1000;
const MIN_CONTRACT = 100;

let cache = null;
let loading = null;

async function loadFromDb() {
  const [users, webSubs, fcmTokens] = await Promise.all([
    fetchAll(() => supabase
      .from('users')
      .select('id, interests, home_lat, home_lng, mute_event_recommendations, is_volt_subscriber, is_enterprise')
      .order('id')),
    fetchAll(() => supabase.from('push_subscriptions').select('user_id, endpoint').order('endpoint')),
    fetchAll(() => supabase.from('fcm_tokens').select('user_id, token').order('token')),
  ]);

  const withPush = new Set();
  for (const r of webSubs) withPush.add(r.user_id);
  for (const r of fcmTokens) withPush.add(r.user_id);

  const byId = new Map();
  for (const u of users) {
    byId.set(u.id, {
      id: u.id,
      interests: new Set((u.interests || []).filter(Boolean)),
      home: u.home_lat != null && u.home_lng != null
        ? { lat: Number(u.home_lat), lng: Number(u.home_lng) }
        : null,
      mutedEvents: !!u.mute_event_recommendations,
      adFree: !!(u.is_volt_subscriber || u.is_enterprise),
      isVolt: !!u.is_volt_subscriber,
      hasPush: withPush.has(u.id),
    });
  }
  return byId;
}

/** Map userId → datos publicitarios. En caché 1 min (lo pide cada pantalla). */
async function loadAudience({ fresh = false } = {}) {
  const now = Date.now();
  if (!fresh && cache && now - cache.at < CACHE_MS) return cache.users;
  if (!loading) {
    loading = loadFromDb()
      .then(users => { cache = { at: Date.now(), users }; return users; })
      .finally(() => { loading = null; });
  }
  return loading;
}

function clearAudienceCache() { cache = null; }

/** ¿Puede recibir push promocionales de eventos de otras comunidades? */
function canReceivePromoPush(user) {
  return user.hasPush && !user.mutedEvents && !user.adFree;
}

function matchesInterests(user, categories) {
  for (const cat of categories) if (user.interests.has(cat)) return true;
  return false;
}

function isWithin(user, center) {
  return !!user.home && haversineKm(center.lat, center.lng, user.home.lat, user.home.lng) <= center.radiusKm;
}

/**
 * Filtros duros de un evento (intereses y/o ubicación). Devuelve null si no
 * tiene ninguno, o una función (user) => boolean.
 */
function makeEventHardFilter(event) {
  const categories = (event.categories || []).filter(Boolean);
  const interestedOnly = !!event.audience_interested_only;
  const center = event.audience_center_lat != null && event.audience_radius_km != null
    ? {
        lat: Number(event.audience_center_lat),
        lng: Number(event.audience_center_lng),
        radiusKm: Number(event.audience_radius_km),
      }
    : null;
  if (!interestedOnly && !center) return null;
  return (user) =>
    (!interestedOnly || matchesInterests(user, categories)) &&
    (!center || isWithin(user, center));
}

async function getCommunityMemberIdSet(communityId) {
  const rows = await fetchAll(() => supabase
    .from('community_members').select('user_id')
    .eq('community_id', communityId).order('user_id'));
  return new Set(rows.map(r => r.user_id));
}

/** Usuarios a los que se puede llegar con la promoción de push de un evento. */
async function getEventAudience({ creatorId, communityId }) {
  const [audience, members] = await Promise.all([
    loadAudience(), getCommunityMemberIdSet(communityId),
  ]);
  return [...audience.values()].filter(u =>
    u.id !== creatorId && !members.has(u.id) && canReceivePromoPush(u));
}

/** Nunca se vende más alcance del que existe (con un mínimo de 100). */
function clampContracted(requested, reachable) {
  return Math.min(requested, Math.max(MIN_CONTRACT, reachable));
}

module.exports = {
  loadAudience,
  clearAudienceCache,
  canReceivePromoPush,
  matchesInterests,
  isWithin,
  makeEventHardFilter,
  getCommunityMemberIdSet,
  getEventAudience,
  clampContracted,
};
