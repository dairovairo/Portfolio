// Tests del reparto de promociones, banners, plan y horario de envío.
// Correr con: node --test server/test/promotion.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

function mock(path, exports) {
  const id = require.resolve(path);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
mock('../lib/supabase', { from: () => { throw new Error('sin base de datos'); } });
mock('../lib/webpush', {});
mock('../lib/fcm', {});

const { getNotificationDayKey, isPromoSendingTime } = require('../lib/notificationDay');
const { rankEvents, assignUsers } = require('../jobs/eventPromoPacing');
const { canSeeBanner, effectiveCategories, VOLT_BANNER_CAP } = require('../lib/raffles');
const { clampContracted } = require('../lib/audience');
const { buildRaffleRules } = require('../lib/raffleRules');
const wallet = require('../lib/wallet');

const at = (iso) => new Date(iso);
const days = (n, from = new Date()) => new Date(from.getTime() + n * 24 * 3600 * 1000).toISOString();

// ─── Horario ──────────────────────────────────────────────────────────
test('horario: solo de 10 a 21 h peninsular, en invierno y en verano', () => {
  assert.equal(isPromoSendingTime(at('2026-01-15T08:59:00Z')), false); // 9:59
  assert.equal(isPromoSendingTime(at('2026-01-15T09:00:00Z')), true); // 10:00
  assert.equal(isPromoSendingTime(at('2026-07-15T18:59:00Z')), true); // 20:59
  assert.equal(isPromoSendingTime(at('2026-07-15T19:00:00Z')), false); // 21:00
});

test('el día de las notificaciones cambia a medianoche peninsular', () => {
  assert.notEqual(
    getNotificationDayKey(at('2026-07-15T21:59:00Z')),
    getNotificationDayKey(at('2026-07-15T22:01:00Z')));
});

// ─── Reparto ──────────────────────────────────────────────────────────
const event = (id, o = {}) => ({
  id, event_date: days(10), promotion_plan: 'premium', notification_count: 500,
  notification_sent_count: 0, categories: [], ...o,
});

test('rankEvents: primero los urgentes; luego, el que menos ha enviado hoy', () => {
  const list = [event('grande', { notification_count: 50000 }), event('chico'), event('urgente', { event_date: days(1) })];
  const ranked = rankEvents(list, new Map([['grande', 50], ['chico', 10]]));
  assert.deepEqual(ranked.map(e => e.id), ['urgente', 'chico', 'grande']);
});

test('rankEvents: contratar más no da prioridad', () => {
  const list = [event('grande', { notification_count: 50000 }), event('chico', { event_date: days(9) })];
  assert.equal(rankEvents(list, new Map())[0].id, 'chico');
});

const person = (id, interests = []) => ({
  userId: id, user: { id, interests: new Set(interests), home: null },
});

test('assignUsers: respeta lo contratado, las exclusiones y no repite usuario', () => {
  const users = Array.from({ length: 100 }, (_, i) => person(`u${i}`));
  const result = assignUsers({
    rankedEvents: [event('a', { notification_count: 10 }), event('b', { notification_count: 500 })],
    users,
    interestsByUser: new Map(users.map(u => [u.userId, u.user.interests])),
    excludeByEvent: new Map([['a', new Set(['u0', 'u1'])], ['b', new Set()]]),
  });
  const byId = Object.fromEntries(result.map(r => [r.event.id, r.chosen.map(c => c.userId)]));
  assert.equal(byId.a.length, 10);
  assert.ok(byId.b.length <= 50);
  assert.ok(!byId.a.includes('u0') && !byId.a.includes('u1'));
  assert.equal(new Set([...byId.a, ...byId.b]).size, byId.a.length + byId.b.length);
});

test('assignUsers: con "solo interesados" no sale del filtro aunque sobre gente', () => {
  const users = [person('si', ['Música']), ...Array.from({ length: 30 }, (_, i) => person(`no${i}`, ['Arte']))];
  const [only] = assignUsers({
    rankedEvents: [event('a', { categories: ['Música'], audience_interested_only: true })],
    users,
    interestsByUser: new Map(users.map(u => [u.userId, u.user.interests])),
    excludeByEvent: new Map(),
  });
  assert.deepEqual(only.chosen.map(c => c.userId), ['si']);
});

test('clampContracted: no se contrata más de lo que existe, con el mínimo de siempre', () => {
  assert.equal(clampContracted(1000, 400), 400);
  assert.equal(clampContracted(300, 400), 300);
  assert.ok(clampContracted(1000, 12) >= 100);
});

// ─── Banners de sorteo ────────────────────────────────────────────────
const viewer = (o = {}) => ({ id: 'u', interests: new Set(['Música']), adFree: false, ...o });
const see = (raffle, o = {}) => canSeeBanner({
  raffle: { creator_id: 'boss', banner_views_contracted: 100, ...raffle },
  categories: ['Música'], user: viewer(), isMember: false, shown: 0, ...o,
});

test('banner Community: solo miembros', () => {
  assert.equal(see({ tier: 'community' }), false);
  assert.equal(see({ tier: 'community' }, { isMember: true }), true);
});

test('banner Light: solo gente de fuera, sin pasarse de lo contratado', () => {
  assert.equal(see({ tier: 'light' }), true);
  assert.equal(see({ tier: 'light' }, { isMember: true }), false);
  assert.equal(see({ tier: 'light' }, { shown: 100 }), false);
  assert.equal(see({ tier: 'light' }, { user: viewer({ adFree: true }) }), false);
});

test('banner Light "solo interesados"', () => {
  assert.equal(see({ tier: 'light', banner_interested_only: true }), true);
  assert.equal(see({ tier: 'light', banner_interested_only: true }, { user: viewer({ interests: new Set() }) }), false);
});

test('banner Volt: los miembros siempre; el resto, hasta el tope', () => {
  assert.equal(see({ tier: 'volt' }, { shown: VOLT_BANNER_CAP }), false);
  assert.equal(see({ tier: 'volt' }, { shown: VOLT_BANNER_CAP, isMember: true }), true);
});

test('el creador no ve su propio banner', () => {
  assert.equal(see({ tier: 'community', creator_id: 'u' }, { isMember: true }), false);
});

test('effectiveCategories: las del sorteo mandan sobre las de la comunidad', () => {
  assert.deepEqual(effectiveCategories(['Arte'], ['Música']), ['Arte']);
  assert.deepEqual(effectiveCategories([], ['Música']), ['Música']);
});

// ─── Cobro ────────────────────────────────────────────────────────────
const hold = { amount_cents: 450, unit_price_cents: 2, extra_unit_price_cents: 1, units_contracted: 200, free_units: 50 };

test('previewChargeCents: las primeras 50 entregas son gratis y hay tope', () => {
  assert.equal(wallet.previewChargeCents(hold, 50, 50), 0);
  assert.equal(wallet.previewChargeCents(hold, 120, 60), 70 * 2 + 10);
  assert.equal(wallet.previewChargeCents(hold, 9999, 9999), 450);
});

test('previewRefundCents: vuelve todo lo no entregado', () => {
  assert.equal(wallet.previewRefundCents(hold, 0), 450);
  assert.equal(wallet.previewRefundCents(null, 10), 0);
});

// ─── Bases ────────────────────────────────────────────────────────────
test('las bases dicen quién organiza, que es gratis y qué depende de la meta', () => {
  const text = buildRaffleRules({
    raffle: {
      title: 'Sorteo', tier: 'community', ends_at: days(5), goal_cents: 10000,
      organizer_name: 'Ana', organizer_contact: 'ana@example.com', draw_commit: 'abc',
    },
    prizes: [{ position: 1, title: 'Camiseta', value_cents: 1500 }, { position: 2, title: 'Consola', requires_goal: true }],
    communityName: 'C',
  });
  for (const part of ['Ana', 'ana@example.com', 'mayores de 18', 'gratuita', '100,00 €', 'Consola', 'abc', 'Ni SocialBattery, ni Google']) {
    assert.ok(text.includes(part), `falta: ${part}`);
  }
});
