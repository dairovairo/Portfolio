// Tests unitarios de las piezas puras del sistema de reparto publicitario.
// Correr con:
//
//   node --test server/test/promoDistribution.test.js
//
// Cubre las funciones extraídas a server/lib/promoDistribution.js:
//
//   - pickRaffleFromRatioGroups: elige qué avioneta enseñar al usuario
//     cuando tiene varios sorteos pendientes de un mismo tier (Volt o
//     Light). Grupos de 3 por peor ratio, con reglas de match de
//     intereses y de "no servible por interested_only".
//
//   - assignCandidatesBidirectional: reparto usuario-a-usuario en la
//     Ronda 2 de eventos Premium/Ultra, con preferencia bidireccional
//     por coincidencia de categoría del evento con los intereses del
//     candidato.
//
//   - makeInterestClassifier: decide si un envío se etiqueta como
//     interesado / no interesado / sin clasificar, que es lo que luego
//     desglosa el dashboard de publicidad (fase 111).
//
// Cada test construye datos sintéticos mínimos, sin BD ni red.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  pickRaffleFromRatioGroups,
  assignCandidatesBidirectional,
  makeInterestClassifier,
} = require('../lib/promoDistribution');
const { BOOST_GROUP_SIZE } = require('../lib/adaptiveBoost');

// ─── Constante compartida ─────────────────────────────────────────────

test('BOOST_GROUP_SIZE es 3 (compartido entre reparto de eventos y avioneta de sorteos)', () => {
  assert.equal(BOOST_GROUP_SIZE, 3);
});

// ─── Helpers de construcción de datos sintéticos para sorteos ─────────

// Construye un "row" del formato que espera pickRaffleFromRatioGroups
// (mismo shape que el SELECT de raffle_banner_targets con embed de
// raffle + community). Solo lo estrictamente necesario para la función.
function raffleRow({ id, categories = [], banner_interested_only = false, community_id = 'C' }) {
  return {
    raffle: {
      id,
      community_id,
      banner_interested_only,
      community: { categories },
    },
  };
}

// Prepara los mapas y callbacks tal como los construye community.js/
// pickWithinTier antes de llamar al helper.
function buildRafflePickInput(rows, ratios, userInterests) {
  const sortedIds = rows
    .map(r => r.raffle.id)
    .sort((a, b) => (ratios[a] ?? 0) - (ratios[b] ?? 0));
  const rowsById = new Map(rows.map(r => [r.raffle.id, r]));
  const ratioById = new Map(Object.entries(ratios));
  const ownInterests = new Set(userInterests);
  const matchesCategory = row =>
    (row.raffle.community?.categories || []).some(cat => ownInterests.has(cat));
  const isRestricted = row => row.raffle.banner_interested_only === true;
  return { sortedIds, rowsById, ratioById, matchesCategory, isRestricted };
}

// ─── pickRaffleFromRatioGroups ────────────────────────────────────────

test('pickRaffle: lista vacía devuelve null (caller cae a rows[0])', () => {
  const input = buildRafflePickInput([], {}, ['deporte']);
  const picked = pickRaffleFromRatioGroups(input);
  assert.equal(picked, null);
});

test('pickRaffle: 1 sorteo, matchea intereses → lo devuelve', () => {
  const rows = [raffleRow({ id: 'r1', categories: ['deporte'] })];
  const input = buildRafflePickInput(rows, { r1: 0.2 }, ['deporte']);
  const picked = pickRaffleFromRatioGroups(input);
  assert.equal(picked?.raffle.id, 'r1');
});

test('pickRaffle: 1 sorteo, NO matchea, no restringido → lo devuelve (regla worst-ratio a secas)', () => {
  const rows = [raffleRow({ id: 'r1', categories: ['arte'] })];
  const input = buildRafflePickInput(rows, { r1: 0.5 }, ['deporte']);
  const picked = pickRaffleFromRatioGroups(input);
  assert.equal(picked?.raffle.id, 'r1');
});

test('pickRaffle: 1 sorteo, NO matchea, banner_interested_only → devuelve null', () => {
  const rows = [raffleRow({ id: 'r1', categories: ['arte'], banner_interested_only: true })];
  const input = buildRafflePickInput(rows, { r1: 0.1 }, ['deporte']);
  const picked = pickRaffleFromRatioGroups(input);
  assert.equal(picked, null);
});

test('pickRaffle: grupo de 3, uno matchea → gana el que matchea (no el peor ratio absoluto)', () => {
  // r1 tiene el peor ratio (0.1) pero NO matchea.
  // r2 y r3 no matchean. Solo r2 sí sería match si tuviera esa cat.
  // Ajustemos: solo r3 matchea, tiene ratio intermedio.
  const rows = [
    raffleRow({ id: 'r1', categories: ['arte'] }),
    raffleRow({ id: 'r2', categories: ['música'] }),
    raffleRow({ id: 'r3', categories: ['deporte'] }),
  ];
  const input = buildRafflePickInput(rows, { r1: 0.1, r2: 0.3, r3: 0.5 }, ['deporte']);
  const picked = pickRaffleFromRatioGroups(input);
  assert.equal(picked?.raffle.id, 'r3', 'debe ganar el que matchea aunque no sea el peor ratio');
});

test('pickRaffle: grupo de 3, VARIOS matchean → gana el de PEOR ratio de entre los matches', () => {
  const rows = [
    raffleRow({ id: 'r1', categories: ['deporte'] }), // peor ratio
    raffleRow({ id: 'r2', categories: ['deporte'] }),
    raffleRow({ id: 'r3', categories: ['arte'] }),
  ];
  const input = buildRafflePickInput(rows, { r1: 0.1, r2: 0.5, r3: 0.3 }, ['deporte']);
  const picked = pickRaffleFromRatioGroups(input);
  assert.equal(picked?.raffle.id, 'r1', 'r1 matchea Y es el peor ratio');
});

test('pickRaffle: grupo de 3, NINGUNO matchea, ninguno restringido → gana el de peor ratio', () => {
  const rows = [
    raffleRow({ id: 'r1', categories: ['arte'] }),
    raffleRow({ id: 'r2', categories: ['música'] }),
    raffleRow({ id: 'r3', categories: ['cine'] }),
  ];
  const input = buildRafflePickInput(rows, { r1: 0.1, r2: 0.3, r3: 0.5 }, ['deporte']);
  const picked = pickRaffleFromRatioGroups(input);
  assert.equal(picked?.raffle.id, 'r1');
});

test('pickRaffle: grupo de 3, ninguno matchea, UNO restringido → gana peor ratio de los NO restringidos', () => {
  const rows = [
    raffleRow({ id: 'r1', categories: ['arte'], banner_interested_only: true }), // peor ratio pero restringido
    raffleRow({ id: 'r2', categories: ['música'] }),
    raffleRow({ id: 'r3', categories: ['cine'] }),
  ];
  const input = buildRafflePickInput(rows, { r1: 0.1, r2: 0.3, r3: 0.5 }, ['deporte']);
  const picked = pickRaffleFromRatioGroups(input);
  assert.equal(picked?.raffle.id, 'r2', 'r1 se descarta por restringido, gana r2 (peor ratio de los servibles)');
});

test('pickRaffle: grupo de 3, ninguno matchea, TODOS restringidos → salta al siguiente grupo', () => {
  const rows = [
    raffleRow({ id: 'r1', categories: ['arte'],   banner_interested_only: true }),
    raffleRow({ id: 'r2', categories: ['música'], banner_interested_only: true }),
    raffleRow({ id: 'r3', categories: ['cine'],   banner_interested_only: true }),
    // Grupo 2 — sin restricciones, r4 debería ganar por peor ratio.
    raffleRow({ id: 'r4', categories: ['jazz'] }),
    raffleRow({ id: 'r5', categories: ['ópera'] }),
    raffleRow({ id: 'r6', categories: ['dj'] }),
  ];
  const input = buildRafflePickInput(
    rows,
    { r1: 0.1, r2: 0.2, r3: 0.3, r4: 0.4, r5: 0.6, r6: 0.8 },
    ['deporte'],
  );
  const picked = pickRaffleFromRatioGroups(input);
  assert.equal(picked?.raffle.id, 'r4', 'primer grupo todo restringido sin match, avanza al segundo');
});

test('pickRaffle: grupo de 3 con match evita que se avance a siguiente grupo', () => {
  const rows = [
    raffleRow({ id: 'r1', categories: ['deporte'] }), // matchea → gana
    raffleRow({ id: 'r2', categories: ['arte'] }),
    raffleRow({ id: 'r3', categories: ['música'] }),
    raffleRow({ id: 'r4', categories: ['deporte'] }), // también matchearía pero está en grupo 2 (mejor ratio)
  ];
  // r1..r3 con peor ratio → primer grupo. r4 con mejor ratio → segundo grupo.
  const input = buildRafflePickInput(
    rows,
    { r1: 0.1, r2: 0.2, r3: 0.3, r4: 0.9 },
    ['deporte'],
  );
  const picked = pickRaffleFromRatioGroups(input);
  assert.equal(picked?.raffle.id, 'r1', 'no debe llegar a r4, el primer grupo ya tenía un match');
});

test('pickRaffle: lista >3 sin ningún match y sin restricciones — devuelve peor ratio del PRIMER grupo', () => {
  // Este comportamiento es intencional: si el primer grupo tiene servibles,
  // el algoritmo no explora el segundo. r4 en grupo 2 no llega a evaluarse
  // aunque hipotéticamente tuviera un peor ratio no importa — solo llegamos
  // aquí si el primero no resolvió.
  const rows = [
    raffleRow({ id: 'r1', categories: ['arte'] }),
    raffleRow({ id: 'r2', categories: ['música'] }),
    raffleRow({ id: 'r3', categories: ['cine'] }),
    raffleRow({ id: 'r4', categories: ['jazz'] }),
  ];
  const input = buildRafflePickInput(
    rows,
    { r1: 0.2, r2: 0.4, r3: 0.6, r4: 0.9 },
    ['deporte'],
  );
  const picked = pickRaffleFromRatioGroups(input);
  assert.equal(picked?.raffle.id, 'r1', 'peor ratio del primer grupo (r1); r4 en el segundo no se explora');
});

test('pickRaffle: Volt-like (ningún sorteo restringido) → siempre peor ratio, nunca null', () => {
  // Volt no tiene banner_interested_only, todos los rows tienen isRestricted=false.
  const rows = [
    raffleRow({ id: 'r1', categories: ['arte'] }),
    raffleRow({ id: 'r2', categories: [] }), // sin categorías, no matchea nada
    raffleRow({ id: 'r3', categories: ['música'] }),
  ];
  const input = buildRafflePickInput(rows, { r1: 0.3, r2: 0.1, r3: 0.5 }, ['deporte']);
  const picked = pickRaffleFromRatioGroups(input);
  assert.equal(picked?.raffle.id, 'r2', 'ningún match posible → peor ratio del grupo');
});

test('pickRaffle: usuario sin intereses (interests vacíos) → nunca matchea, cae a peor ratio', () => {
  const rows = [
    raffleRow({ id: 'r1', categories: ['deporte'] }),
    raffleRow({ id: 'r2', categories: ['arte'] }),
  ];
  const input = buildRafflePickInput(rows, { r1: 0.6, r2: 0.2 }, []);
  const picked = pickRaffleFromRatioGroups(input);
  assert.equal(picked?.raffle.id, 'r2', 'sin intereses no hay match, gana peor ratio');
});

// ─── assignCandidatesBidirectional ────────────────────────────────────

function makeMeta({ id, remaining = 50, excluded = [], categories = [] }) {
  return {
    id,
    remaining,
    excludeSet: new Set(excluded),
    eventCategories: new Set(categories),
    chosen: [],
  };
}

function makeCandidate(userId) {
  return { userId };
}

test('assign: sin candidatos devuelve pool vacío, no toca metas', () => {
  const metas = [makeMeta({ id: 'e1', categories: ['deporte'] })];
  const still = assignCandidatesBidirectional({
    candidates: [],
    eventMetas: metas,
    interestsByUser: new Map(),
  });
  assert.deepEqual(still, []);
  assert.equal(metas[0].remaining, 50);
  assert.equal(metas[0].chosen.length, 0);
});

test('assign: sin eventos devuelve todos los candidatos intactos', () => {
  const candidates = [makeCandidate('u1'), makeCandidate('u2')];
  const still = assignCandidatesBidirectional({
    candidates,
    eventMetas: [],
    interestsByUser: new Map(),
  });
  assert.equal(still.length, 2);
});

test('assign: 1 usuario, 1 evento sin categorías → se asigna al evento (fallback)', () => {
  const metas = [makeMeta({ id: 'e1', categories: [] })];
  const candidates = [makeCandidate('u1')];
  const still = assignCandidatesBidirectional({
    candidates,
    eventMetas: metas,
    interestsByUser: new Map([['u1', new Set(['deporte'])]]),
  });
  assert.equal(still.length, 0);
  assert.equal(metas[0].chosen.length, 1);
  assert.equal(metas[0].remaining, 49);
});

test('assign: match bidireccional — usuario matchea evento con peor categoría, otro evento peor ratio pero sin match', () => {
  // e1: peor ratio (primero del array), categoría "arte" (no matchea)
  // e2: mejor ratio (segundo), categoría "deporte" (matchea intereses del usuario)
  // Usuario "u1" con interés "deporte" → debe ir a e2 aunque e1 tenga peor ratio.
  const e1 = makeMeta({ id: 'e1', categories: ['arte'] });
  const e2 = makeMeta({ id: 'e2', categories: ['deporte'] });
  const candidates = [makeCandidate('u1')];
  assignCandidatesBidirectional({
    candidates,
    eventMetas: [e1, e2],
    interestsByUser: new Map([['u1', new Set(['deporte'])]]),
  });
  assert.equal(e1.chosen.length, 0, 'e1 no recibe a u1 aunque tenga peor ratio');
  assert.equal(e2.chosen.length, 1, 'u1 va a e2 porque matchea intereses');
});

test('assign: varios eventos matchean → gana el de peor ratio (orden en eventMetas)', () => {
  // Ambos matchean, e1 va primero en el array (peor ratio).
  const e1 = makeMeta({ id: 'e1', categories: ['deporte'] });
  const e2 = makeMeta({ id: 'e2', categories: ['deporte', 'arte'] });
  assignCandidatesBidirectional({
    candidates: [makeCandidate('u1')],
    eventMetas: [e1, e2],
    interestsByUser: new Map([['u1', new Set(['deporte'])]]),
  });
  assert.equal(e1.chosen.length, 1, 'entre matches, peor ratio (e1) gana');
  assert.equal(e2.chosen.length, 0);
});

test('assign: ningún evento matchea → fallback al peor ratio elegible', () => {
  const e1 = makeMeta({ id: 'e1', categories: ['arte'] });   // peor ratio
  const e2 = makeMeta({ id: 'e2', categories: ['música'] }); // mejor ratio
  assignCandidatesBidirectional({
    candidates: [makeCandidate('u1')],
    eventMetas: [e1, e2],
    interestsByUser: new Map([['u1', new Set(['deporte'])]]),
  });
  assert.equal(e1.chosen.length, 1, 'sin match, gana el peor ratio (e1)');
  assert.equal(e2.chosen.length, 0);
});

test('assign: excludeSet respetado — evento con el usuario excluido no lo recibe', () => {
  const e1 = makeMeta({ id: 'e1', categories: ['deporte'], excluded: ['u1'] }); // excluido
  const e2 = makeMeta({ id: 'e2', categories: ['arte'] });                     // fallback
  assignCandidatesBidirectional({
    candidates: [makeCandidate('u1')],
    eventMetas: [e1, e2],
    interestsByUser: new Map([['u1', new Set(['deporte'])]]),
  });
  assert.equal(e1.chosen.length, 0, 'e1 excluye a u1');
  assert.equal(e2.chosen.length, 1, 'cae a e2 aunque no matchee (única opción)');
});

test('assign: candidato excluido de TODOS los eventos → queda libre en stillAvailable', () => {
  const e1 = makeMeta({ id: 'e1', categories: ['deporte'], excluded: ['u1'] });
  const e2 = makeMeta({ id: 'e2', categories: ['arte'],    excluded: ['u1'] });
  const still = assignCandidatesBidirectional({
    candidates: [makeCandidate('u1')],
    eventMetas: [e1, e2],
    interestsByUser: new Map([['u1', new Set(['deporte'])]]),
  });
  assert.deepEqual(still.map(c => c.userId), ['u1']);
  assert.equal(e1.chosen.length, 0);
  assert.equal(e2.chosen.length, 0);
});

test('assign: chunk se respeta — evento con remaining=1 solo recibe 1 candidato', () => {
  const e1 = makeMeta({ id: 'e1', categories: ['deporte'], remaining: 1 });
  const e2 = makeMeta({ id: 'e2', categories: ['deporte'], remaining: 50 });
  // 3 candidatos con interés "deporte" — e1 solo puede coger 1.
  const candidates = [
    makeCandidate('u1'),
    makeCandidate('u2'),
    makeCandidate('u3'),
  ];
  const interestsByUser = new Map([
    ['u1', new Set(['deporte'])],
    ['u2', new Set(['deporte'])],
    ['u3', new Set(['deporte'])],
  ]);
  assignCandidatesBidirectional({ candidates, eventMetas: [e1, e2], interestsByUser });
  assert.equal(e1.chosen.length, 1, 'e1 solo coge 1 (su remaining)');
  assert.equal(e1.remaining, 0);
  assert.equal(e2.chosen.length, 2, 'los otros 2 caen en e2 (también matchean)');
  assert.equal(e2.remaining, 48);
});

test('assign: usuario sin intereses cargados → siempre fallback a peor ratio elegible', () => {
  const e1 = makeMeta({ id: 'e1', categories: ['arte'] });
  const e2 = makeMeta({ id: 'e2', categories: ['deporte'] });
  // Mapa vacío — u1 no tiene entrada.
  assignCandidatesBidirectional({
    candidates: [makeCandidate('u1')],
    eventMetas: [e1, e2],
    interestsByUser: new Map(),
  });
  assert.equal(e1.chosen.length, 1, 'sin intereses cargados, gana peor ratio');
  assert.equal(e2.chosen.length, 0);
});

test('assign: usuario con Set de intereses vacío → fallback (no crash)', () => {
  const e1 = makeMeta({ id: 'e1', categories: ['arte'] });
  const e2 = makeMeta({ id: 'e2', categories: ['deporte'] });
  assignCandidatesBidirectional({
    candidates: [makeCandidate('u1')],
    eventMetas: [e1, e2],
    interestsByUser: new Map([['u1', new Set()]]),
  });
  assert.equal(e1.chosen.length, 1);
  assert.equal(e2.chosen.length, 0);
});

test('assign: evento sin categorías nunca aparece en "matching" (solo en fallback)', () => {
  // e1 sin categorías; e2 con match — u1 debe ir a e2 aunque e1 sea peor ratio.
  const e1 = makeMeta({ id: 'e1', categories: [] });
  const e2 = makeMeta({ id: 'e2', categories: ['deporte'] });
  assignCandidatesBidirectional({
    candidates: [makeCandidate('u1')],
    eventMetas: [e1, e2],
    interestsByUser: new Map([['u1', new Set(['deporte'])]]),
  });
  assert.equal(e1.chosen.length, 0);
  assert.equal(e2.chosen.length, 1);
});

test('assign: reparto MIXTO — cada usuario cae en su match, quien no matchea cae en el peor ratio', () => {
  // e1 categorías arte, peor ratio.
  // e2 categorías deporte, mejor ratio.
  const e1 = makeMeta({ id: 'e1', categories: ['arte'],    remaining: 10 });
  const e2 = makeMeta({ id: 'e2', categories: ['deporte'], remaining: 10 });
  const candidates = [
    makeCandidate('u1'), // deporte → e2
    makeCandidate('u2'), // arte    → e1
    makeCandidate('u3'), // sin match → e1 (peor ratio)
    makeCandidate('u4'), // deporte → e2
  ];
  const interestsByUser = new Map([
    ['u1', new Set(['deporte'])],
    ['u2', new Set(['arte'])],
    ['u3', new Set(['música'])],
    ['u4', new Set(['deporte'])],
  ]);
  assignCandidatesBidirectional({ candidates, eventMetas: [e1, e2], interestsByUser });
  assert.equal(e1.chosen.length, 2, 'u2 (match) + u3 (fallback peor ratio)');
  assert.equal(e2.chosen.length, 2, 'u1 y u4 (ambos matchean deporte)');
});

// ── makeInterestClassifier (fase 111) ──────────────────────────────────────
// Decide qué se congela en event_promo_notifications.matched_interest en el
// momento del envío, que es lo que luego alimenta el desglose
// interesados/no interesados y el CTR por segmento del dashboard de
// publicidad. La regla clave que cubren estos tests es la distinción entre
// false ("se pudo preguntar y no coincide") y null ("no se pudo preguntar"):
// confundirlos ensuciaría el CTR con ceros inventados.

test('classifier: evento sin categorías no es clasificable (null, no una función)', () => {
  assert.equal(makeInterestClassifier(new Set(), new Map()), null);
  assert.equal(makeInterestClassifier(null, new Map()), null);
  assert.equal(makeInterestClassifier(undefined, new Map()), null);
});

test('classifier: intereses que cruzan → true', () => {
  const fn = makeInterestClassifier(
    new Set(['Música', 'Deporte']),
    new Map([['u1', new Set(['Deporte', 'Cine'])]])
  );
  assert.equal(fn('u1'), true);
});

test('classifier: intereses que no cruzan → false', () => {
  const fn = makeInterestClassifier(
    new Set(['Música']),
    new Map([['u1', new Set(['Cine', 'Deporte'])]])
  );
  assert.equal(fn('u1'), false);
});

test('classifier: usuario con intereses vacíos → false (se pudo preguntar, no coincide)', () => {
  const fn = makeInterestClassifier(
    new Set(['Música']),
    new Map([['u1', new Set()]])
  );
  assert.equal(fn('u1'), false);
});

test('classifier: usuario sin intereses cargados → null (no se pudo preguntar, no false)', () => {
  const fn = makeInterestClassifier(new Set(['Música']), new Map());
  assert.equal(fn('desconocido'), null);
});

test('classifier: basta una categoría en común de varias', () => {
  const fn = makeInterestClassifier(
    new Set(['Música', 'Arte', 'Deporte']),
    new Map([
      ['u1', new Set(['Cine', 'Arte'])],
      ['u2', new Set(['Cine', 'Viajes'])],
    ])
  );
  assert.equal(fn('u1'), true);
  assert.equal(fn('u2'), false);
});
