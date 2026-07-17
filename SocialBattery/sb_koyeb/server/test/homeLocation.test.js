// Tests unitarios de lib/homeLocation.js — usa el test runner nativo:
//   node --test server/test/homeLocation.test.js
//
// Cubre las cuatro reglas de resolveHomeLocationUpdate (set_home,
// confirm_home, promote_pending_to_home, set_pending / replace_pending)
// y el comportamiento de haversineKm en casos límite.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveHomeLocationUpdate,
  haversineKm,
  DEFAULT_CONFIRM_METERS,
} = require('../lib/homeLocation');

// Coordenadas base para los tests (Puertollano, Castilla-La Mancha).
// Todas las variantes que se usan abajo se calculan como delta desde aquí.
const P = { lat: 38.6875, lng: -4.1075 };

// A 1 grado de latitud ≈ 111 km. Estas son distancias aproximadas:
//   +0.001 lat ≈ 111 m
//   +0.01 lat  ≈ 1.1 km
const near = (base, dLat = 0.001, dLng = 0.001) => ({ lat: base.lat + dLat, lng: base.lng + dLng });
const far  = (base, dLat = 0.5,   dLng = 0.5)   => ({ lat: base.lat + dLat, lng: base.lng + dLng });

// ─── haversineKm ──────────────────────────────────────────────────────

test('haversineKm: distancia consigo mismo es 0', () => {
  assert.equal(haversineKm(P.lat, P.lng, P.lat, P.lng), 0);
});

test('haversineKm: ~111 km por cada grado de latitud (aprox)', () => {
  const d = haversineKm(P.lat, P.lng, P.lat + 1, P.lng);
  assert.ok(d > 110 && d < 112, `esperado ~111 km, dio ${d.toFixed(2)}`);
});

test('haversineKm: puntos antípodas ≈ media circunferencia (~20015 km)', () => {
  const d = haversineKm(0, 0, 0, 180);
  assert.ok(d > 20000 && d < 20030, `esperado ~20015 km, dio ${d.toFixed(2)}`);
});

test('haversineKm: unos metros son fracciones pequeñas de km', () => {
  // +0.0001 lat ≈ 11 m
  const d = haversineKm(P.lat, P.lng, P.lat + 0.0001, P.lng);
  assert.ok(d < 0.02, `esperado < 20 m, dio ${(d * 1000).toFixed(1)} m`);
});

// ─── resolveHomeLocationUpdate ─────────────────────────────────────────

test('DEFAULT_CONFIRM_METERS es 500', () => {
  assert.equal(DEFAULT_CONFIRM_METERS, 500);
});

test('resolve: sin home ni pending → set_home con el incoming', () => {
  const r = resolveHomeLocationUpdate({ current: null, pending: null, incoming: P });
  assert.equal(r.change, 'set_home');
  assert.deepEqual(r.home, { lat: P.lat, lng: P.lng });
  assert.equal(r.pending, null);
});

test('resolve: incoming muy cerca del home actual → confirm_home, home no cambia', () => {
  const incoming = near(P, 0.001, 0.001); // ~150 m
  const r = resolveHomeLocationUpdate({ current: P, pending: null, incoming });
  assert.equal(r.change, 'confirm_home');
  assert.deepEqual(r.home, P);
  assert.equal(r.pending, null);
});

test('resolve: incoming lejos del home y sin pending → set_pending, home intacto', () => {
  const otro = far(P);
  const r = resolveHomeLocationUpdate({ current: P, pending: null, incoming: otro });
  assert.equal(r.change, 'set_pending');
  assert.deepEqual(r.home, P);
  assert.deepEqual(r.pending, { lat: otro.lat, lng: otro.lng });
});

test('resolve: incoming lejos y hay un pending distinto → replace_pending', () => {
  const pendingViejo = far(P, 0.5, 0.5);
  const nuevo        = far(P, 1.0, 1.0); // otra dirección
  const r = resolveHomeLocationUpdate({
    current: P,
    pending: pendingViejo,
    incoming: nuevo,
  });
  assert.equal(r.change, 'replace_pending');
  assert.deepEqual(r.home, P);
  assert.deepEqual(r.pending, { lat: nuevo.lat, lng: nuevo.lng });
});

test('resolve: incoming cerca del pending existente → promote_pending_to_home', () => {
  const madrid = { lat: 40.4168, lng: -3.7038 };
  const madridCerca = near(madrid, 0.001, 0.001); // ~150 m del pending
  const r = resolveHomeLocationUpdate({
    current: P,
    pending: madrid,
    incoming: madridCerca,
  });
  assert.equal(r.change, 'promote_pending_to_home');
  // El home nuevo es el INCOMING (más reciente), no el pending viejo —
  // ambos están dentro del radio así que da igual, pero conviene fijarlo.
  assert.deepEqual(r.home, { lat: madridCerca.lat, lng: madridCerca.lng });
  assert.equal(r.pending, null);
});

test('resolve: incoming vuelve a estar cerca del home habiendo pending → confirm_home_discard_pending', () => {
  // Escenario: user estaba de paso en Madrid ayer (se guardó como pending),
  // hoy vuelve a Puertollano. El pending se debe descartar.
  const madrid = { lat: 40.4168, lng: -3.7038 };
  const puertollanoCerca = near(P, 0.001, 0.001);
  const r = resolveHomeLocationUpdate({
    current: P,
    pending: madrid,
    incoming: puertollanoCerca,
  });
  assert.equal(r.change, 'confirm_home_discard_pending');
  assert.deepEqual(r.home, P);
  assert.equal(r.pending, null);
});

test('resolve: confirmMeters personalizable (radio de tolerancia menor)', () => {
  // A 300 m del home, con umbral por defecto (500 m) sería confirm.
  // Con umbral estricto (100 m), no confirma → cae en set_pending.
  const cerca300m = near(P, 0.0027, 0); // ~300 m
  const rDefault = resolveHomeLocationUpdate({ current: P, pending: null, incoming: cerca300m });
  const rEstricto = resolveHomeLocationUpdate({
    current: P,
    pending: null,
    incoming: cerca300m,
    confirmMeters: 100,
  });
  assert.equal(rDefault.change, 'confirm_home');
  assert.equal(rEstricto.change, 'set_pending');
});

test('resolve: incoming inválido lanza (no falla silencioso)', () => {
  assert.throws(
    () => resolveHomeLocationUpdate({ current: null, pending: null, incoming: {} }),
    /incoming\.lat\/lng requeridos/
  );
  assert.throws(
    () => resolveHomeLocationUpdate({ current: null, pending: null, incoming: null }),
    /incoming\.lat\/lng requeridos/
  );
});

test('resolve: escenario típico completo — mudanza real', () => {
  // Día 1: primer report en Puertollano → set_home
  let state = { current: null, pending: null };
  let r = resolveHomeLocationUpdate({ ...state, incoming: P });
  state = { current: r.home, pending: r.pending };
  assert.equal(r.change, 'set_home');

  // Día 2: mismo sitio → confirm
  r = resolveHomeLocationUpdate({ ...state, incoming: near(P) });
  state = { current: r.home, pending: r.pending };
  assert.equal(r.change, 'confirm_home');

  // Día 3: se muda a Madrid → set_pending (todavía no cambia el home)
  const madrid = { lat: 40.4168, lng: -3.7038 };
  r = resolveHomeLocationUpdate({ ...state, incoming: madrid });
  state = { current: r.home, pending: r.pending };
  assert.equal(r.change, 'set_pending');
  assert.deepEqual(state.current, P, 'el home aún es Puertollano');

  // Día 4: vuelve a estar en Madrid → promote_pending_to_home
  r = resolveHomeLocationUpdate({ ...state, incoming: near(madrid) });
  state = { current: r.home, pending: r.pending };
  assert.equal(r.change, 'promote_pending_to_home');
  assert.ok(Math.abs(state.current.lat - madrid.lat) < 0.01, 'ya es Madrid');
  assert.equal(state.pending, null);
});

test('resolve: un viaje de un día (Madrid una vez, vuelta a casa) no cambia el home', () => {
  let state = { current: P, pending: null };
  const madrid = { lat: 40.4168, lng: -3.7038 };

  // Report en Madrid (viaje)
  let r = resolveHomeLocationUpdate({ ...state, incoming: madrid });
  state = { current: r.home, pending: r.pending };
  assert.equal(r.change, 'set_pending');

  // Vuelve a casa
  r = resolveHomeLocationUpdate({ ...state, incoming: near(P) });
  state = { current: r.home, pending: r.pending };
  assert.equal(r.change, 'confirm_home_discard_pending');
  assert.deepEqual(state.current, P);
  assert.equal(state.pending, null);
});
