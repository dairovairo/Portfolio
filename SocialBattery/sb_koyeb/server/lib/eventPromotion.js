// ─────────────────────────────────────────────────────────────────────────
// Ciclo de vida de la promoción de un evento
// ─────────────────────────────────────────────────────────────────────────
// Contratar, avisar a la comunidad, liquidar y archivar. Lo usan crear,
// renovar, finalizar y cancelar evento (routes/community.js) y el cron de
// liquidación (jobs/settleAdHolds.js).

const supabase = require('./supabase');
const wallet = require('./wallet');
const freePromo = require('./freePromo');
const { EVENT_AD_PRICING, MIN_UNITS } = require('./adPricing');
const { notifyUsers } = require('./webpush');
const { getNotificationDayKey } = require('./notificationDay');
const { fetchAll, selectInChunks, chunk } = require('./paginate');
const audienceLib = require('./audience');

const NOTIF_MAX = 50000;
const COMMUNITY_NOTICE_COOLDOWN_HOURS = 72;
const BANNER_HOURS = 24;

class PromotionInputError extends Error {
  constructor(message) { super(message); this.status = 400; }
}

const isPaidPlan = (plan) => plan === 'premium' || plan === 'ultra';

const hasValue = (v) => v !== undefined && v !== null && v !== '';

/** Valida plan, cantidad y filtros de audiencia que llegan del cliente. */
function parsePromotion(body, categories) {
  const plan = ['basic', 'premium', 'ultra'].includes(body.promotion_plan) ? body.promotion_plan : 'basic';
  const none = {
    promotion_plan: plan,
    notification_count: null,
    audience_interested_only: false,
    audience_center_lat: null,
    audience_center_lng: null,
    audience_radius_km: null,
  };
  if (!isPaidPlan(plan)) return none;

  const count = Number.parseInt(body.notification_count, 10);
  if (!Number.isFinite(count) || count < MIN_UNITS || count > NOTIF_MAX) {
    throw new PromotionInputError(`Elige cuántas notificaciones quieres contratar (entre ${MIN_UNITS} y ${NOTIF_MAX})`);
  }

  const interestedOnly = body.audience_interested_only === 'true' || body.audience_interested_only === true;
  if (interestedOnly && !categories.length) {
    throw new PromotionInputError('Define categorías en el evento para poder filtrar por intereses');
  }

  const promo = { ...none, notification_count: freePromo.capUnits(count), audience_interested_only: interestedOnly };
  if (hasValue(body.audience_center_lat) && hasValue(body.audience_center_lng) && hasValue(body.audience_radius_km)) {
    const lat = Number.parseFloat(body.audience_center_lat);
    const lng = Number.parseFloat(body.audience_center_lng);
    const radius = Number.parseFloat(body.audience_radius_km);
    if (![lat, lng, radius].every(Number.isFinite)) {
      throw new PromotionInputError('Filtro por ubicación: valores numéricos inválidos');
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new PromotionInputError('Filtro por ubicación: coordenadas fuera de rango');
    }
    if (radius < 1 || radius > 500) {
      throw new PromotionInputError('Filtro por ubicación: el radio debe estar entre 1 y 500 km');
    }
    promo.audience_center_lat = lat;
    promo.audience_center_lng = lng;
    promo.audience_radius_km = radius;
  }
  return promo;
}

/** Recorta lo contratado al público al que de verdad se puede llegar. */
async function fitToAudience(promo, { creatorId, communityId, categories }) {
  if (!isPaidPlan(promo.promotion_plan)) return promo;
  const users = await audienceLib.getEventAudience({ creatorId, communityId });
  const filter = audienceLib.makeEventHardFilter({ ...promo, categories });
  const reachable = filter ? users.filter(filter).length : users.length;
  return { ...promo, notification_count: audienceLib.clampContracted(promo.notification_count, reachable) };
}

function holdParams(promo, freeUnits) {
  const price = EVENT_AD_PRICING[promo.promotion_plan];
  if (!price || !promo.notification_count) return null;
  return {
    kind: 'event',
    plan: promo.promotion_plan,
    units: promo.notification_count,
    unitPriceCents: price.unitPriceCents,
    extraUnitPriceCents: price.bannerPriceCents,
    freeUnits,
    amountCents: Math.max(0, promo.notification_count - freeUnits) * (price.unitPriceCents + price.bannerPriceCents),
  };
}

// ── Entregas de un ciclo ─────────────────────────────────────────────────

async function countRows(build) {
  const { count, error } = await build();
  if (error) throw error;
  return count || 0;
}

/** Banners Ultra cobrables (vistos por gente de fuera de la comunidad). */
async function countBillableBanners(eventId) {
  return countRows(() => supabase
    .from('event_ultra_banner_impressions')
    .select('event_id', { count: 'exact', head: true })
    .eq('event_id', eventId).eq('billable', true));
}

async function countPromoClicks(eventId) {
  return countRows(() => supabase
    .from('event_promo_notifications')
    .select('event_id', { count: 'exact', head: true })
    .eq('event_id', eventId).eq('ad_source', 'promo').not('clicked_at', 'is', null));
}

/** Liquida la reserva abierta con lo entregado hasta ahora. */
async function settleEvent(event, reason) {
  const banners = event.promotion_plan === 'ultra' || !event.promotion_plan
    ? await countBillableBanners(event.id) : 0;
  return wallet.settleCampaign({
    kind: 'event', targetId: event.id,
    unitsDelivered: event.notification_sent_count || 0,
    extraUnits: banners, reason,
  });
}

/**
 * Cierra el ciclo actual: liquida y guarda el resumen en el historial.
 * `event` necesita id, title, community_id, promotion_plan,
 * notification_count, notification_sent_count y ultra_banner_views.
 */
async function closeEventCampaign(event, reason) {
  if (!isPaidPlan(event.promotion_plan)) return null;
  const clicks = await countPromoClicks(event.id);
  const settled = await settleEvent(event, reason);
  const charged = settled?.settled ? settled.charged_cents : await wallet.lastChargedCents('event', event.id);
  const { error } = await supabase.from('ad_campaign_history').insert({
    community_id: event.community_id,
    kind: 'event',
    target_id: event.id,
    title: event.title,
    plan: event.promotion_plan,
    contracted: event.notification_count,
    delivered: event.notification_sent_count || 0,
    clicks,
    banner_views: event.ultra_banner_views || 0,
    charged_cents: charged,
    reason,
  });
  if (error) console.warn('[eventPromotion] no se pudo archivar la campaña:', error.message);
  return settled;
}

/** Borra el rastro del ciclo anterior para empezar uno nuevo. */
async function resetEventCycle(eventId, { keepCommunityNotices }) {
  let query = supabase.from('event_promo_notifications').delete().eq('event_id', eventId);
  if (keepCommunityNotices) query = query.or('ad_source.is.null,ad_source.neq.community');
  const [{ error: e1 }, { error: e2 }] = await Promise.all([
    query,
    supabase.from('event_ultra_banner_impressions').delete().eq('event_id', eventId),
  ]);
  if (e1 || e2) throw (e1 || e2);
}

// ── Avisos a la comunidad ────────────────────────────────────────────────

/** ¿Cuándo se avisó por última vez a la comunidad? (cuenta la publicación) */
async function lastCommunityNotice(event) {
  const { data, error } = await supabase
    .from('event_promo_notifications').select('sent_at')
    .eq('event_id', event.id).eq('ad_source', 'community')
    .order('sent_at', { ascending: false }).limit(1);
  if (error) throw error;
  return new Date(Math.max(
    new Date(event.created_at).getTime() || 0,
    data?.[0]?.sent_at ? new Date(data[0].sent_at).getTime() : 0,
  ));
}

async function communityNoticeAvailableAt(event) {
  const last = await lastCommunityNotice(event);
  return new Date(last.getTime() + COMMUNITY_NOTICE_COOLDOWN_HOURS * 3600 * 1000);
}

/** De una lista de usuarios, los que tienen activado un silencio concreto. */
async function getUsersWithFlag(userIds, column) {
  const rows = await selectInChunks(userIds, ids => supabase
    .from('users').select('id').in('id', ids).eq(column, true).order('id'));
  return new Set(rows.map(r => r.id));
}

/**
 * Aviso a los miembros de la comunidad. No cuenta contra lo contratado ni
 * respeta el tope diario (es su comunidad), pero sí les gasta el hueco del
 * día para que no les llegue además un evento ajeno.
 */
async function notifyCommunityOfEvent(event, { renewed = false } = {}) {
  const [{ data: comm }, memberRows] = await Promise.all([
    supabase.from('communities').select('name').eq('id', event.community_id).single(),
    fetchAll(() => supabase.from('community_members').select('user_id')
      .eq('community_id', event.community_id).neq('user_id', event.creator_id).order('user_id')),
  ]);
  const memberIds = memberRows.map(m => m.user_id);
  const muted = await getUsersWithFlag(memberIds, 'mute_new_events');
  const label = comm?.name ? `en "${comm.name}"` : 'en tu comunidad';

  const notified = await notifyUsers(supabase, memberIds.filter(id => !muted.has(id)), event.creator_id, {
    title: renewed ? `📅 Evento renovado ${label}` : `📅 Nuevo evento ${label}`,
    body: `${event.title}${event.location ? ` · ${event.location}` : ''}`,
    url: `/community/event/${event.id}?src=community`,
    tag: `community-event-${event.id}`,
  });
  if (!notified.length) return;

  const categories = (event.categories || []).filter(Boolean);
  const audience = categories.length ? await audienceLib.loadAudience() : null;
  const dayKey = getNotificationDayKey();
  for (const ids of chunk(notified, 500)) {
    const { error: logError } = await supabase.from('event_promo_notifications').upsert(
      ids.map(uid => ({
        event_id: event.id,
        user_id: uid,
        ad_source: 'community',
        matched_interest: audience?.has(uid)
          ? audienceLib.matchesInterests(audience.get(uid), categories) : null,
      })),
      { onConflict: 'event_id,user_id', ignoreDuplicates: true });
    if (logError) console.warn('[eventPromotion] log del aviso a la comunidad:', logError.message);

    const { error: claimError } = await supabase.from('user_daily_notification_claims').upsert(
      ids.map(uid => ({ user_id: uid, claim_date: dayKey, event_id: event.id })),
      { onConflict: 'user_id,claim_date', ignoreDuplicates: true });
    if (claimError) console.error('[eventPromotion] hueco diario tras aviso a la comunidad:', claimError.message);
  }
}

// ── Banner Ultra del inicio ──────────────────────────────────────────────

const ULTRA_COLUMNS = 'id, title, organization, cover_image_url, promotion_plan, community_id, creator_id, event_date, ends_at, cancelled_at, categories, notification_count, audience_interested_only, audience_center_lat, audience_center_lng, audience_radius_km, community:communities!community_events_community_id_fkey(organization)';

function isLiveUltra(event, now) {
  return event.promotion_plan === 'ultra' && !event.cancelled_at
    && new Date(event.ends_at || event.event_date).getTime() > now;
}

/** Evento Ultra que se le notificó al usuario en las últimas 24 h. */
async function findNotifiedUltra(userId, me, since, now) {
  const { data: notices, error } = await supabase
    .from('event_promo_notifications').select('event_id, sent_at, ad_source')
    .eq('user_id', userId).gte('sent_at', since)
    .order('sent_at', { ascending: false }).limit(20);
  if (error) throw error;
  const relevant = (notices || []).filter(n => !(me?.adFree && n.ad_source !== 'community'));
  if (!relevant.length) return null;
  const { data: events, error: evError } = await supabase
    .from('community_events').select(ULTRA_COLUMNS).in('id', relevant.map(n => n.event_id));
  if (evError) throw evError;
  const byId = new Map((events || []).map(e => [e.id, e]));
  for (const n of relevant) {
    const event = byId.get(n.event_id);
    if (event && isLiveUltra(event, now)) return event;
  }
  return null;
}

/**
 * Quien no tiene push también puede ver el banner: como mucho un evento
 * nuevo al día, respetando filtros y sin pasarse de lo contratado.
 */
async function findUltraForUserWithoutPush(userId, me, since, now) {
  if (!me || me.hasPush || me.mutedEvents || me.adFree) return null;

  const nowIso = new Date(now).toISOString();
  const [{ data: events, error }, { data: seen, error: seenError }, memberships] = await Promise.all([
    supabase.from('community_events').select(ULTRA_COLUMNS)
      .eq('promotion_plan', 'ultra').is('cancelled_at', null)
      .gt('event_date', nowIso)
      .lte('event_date', new Date(now + 21 * 24 * 3600 * 1000).toISOString())
      .order('event_date').limit(200),
    supabase.from('event_ultra_banner_impressions').select('event_id, first_shown_at')
      .eq('user_id', userId).order('first_shown_at', { ascending: false }).limit(200),
    fetchAll(() => supabase.from('community_members').select('community_id')
      .eq('user_id', userId).order('community_id')),
  ]);
  if (error || seenError) throw (error || seenError);

  const byId = new Map((events || []).map(e => [e.id, e]));
  const current = (seen || []).find(s => s.first_shown_at >= since);
  if (current) return byId.get(current.event_id) || null;

  const seenIds = new Set((seen || []).map(s => s.event_id));
  const mine = new Set(memberships.map(m => m.community_id));
  for (const event of events || []) {
    if (seenIds.has(event.id) || mine.has(event.community_id) || event.creator_id === userId) continue;
    const filter = audienceLib.makeEventHardFilter(event);
    if (filter && !filter(me)) continue;
    if (await countBillableBanners(event.id) >= (event.notification_count || 0)) continue;
    return event;
  }
  return null;
}

async function recordUltraImpression(event, userId) {
  const { data: membership } = await supabase
    .from('community_members').select('user_id')
    .eq('community_id', event.community_id).eq('user_id', userId).maybeSingle();
  // La PK (event_id, user_id) hace de "¿ya se había contado?": solo la
  // primera vez devuelve fila.
  const { data: first, error } = await supabase
    .from('event_ultra_banner_impressions')
    .upsert(
      { event_id: event.id, user_id: userId, billable: !membership && event.creator_id !== userId },
      { onConflict: 'event_id,user_id', ignoreDuplicates: true })
    .select('event_id');
  if (error) throw error;
  if (!first?.length) return;
  const { error: rpcError } = await supabase.rpc('increment_event_ultra_banner_views', { p_id: event.id });
  if (rpcError) console.warn('[eventPromotion] increment_event_ultra_banner_views:', rpcError.message);
  const { error: logError } = await supabase.from('promo_metric_events')
    .insert({ kind: 'ultra_banner_view', target_id: event.id, user_id: userId });
  if (logError) console.warn('[eventPromotion] ultra_banner_view log:', logError.message);
}

/** Evento a enseñar en el banner del inicio (o null). */
async function getUltraBannerEvent(userId) {
  const now = Date.now();
  const since = new Date(now - BANNER_HOURS * 3600 * 1000).toISOString();
  const me = (await audienceLib.loadAudience()).get(userId) || null;
  const event = await findNotifiedUltra(userId, me, since, now)
    || await findUltraForUserWithoutPush(userId, me, since, now);
  if (!event) return null;
  recordUltraImpression(event, userId)
    .catch(err => console.warn('[eventPromotion] impresión del banner Ultra:', err.message));
  return event;
}

module.exports = {
  PromotionInputError,
  isPaidPlan,
  parsePromotion,
  fitToAudience,
  holdParams,
  countBillableBanners,
  settleEvent,
  closeEventCampaign,
  resetEventCycle,
  communityNoticeAvailableAt,
  getUsersWithFlag,
  notifyCommunityOfEvent,
  getUltraBannerEvent,
  COMMUNITY_NOTICE_COOLDOWN_HOURS,
};
