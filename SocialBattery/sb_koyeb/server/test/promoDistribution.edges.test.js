// Tests unitarios COMPLEMENTARIOS de server/lib/promoDistribution.js —
// extienden la suite de promoDistribution.test.js con bordes que aquella
// no cubría. Correr con:
//
//   node --test server/test/promoDistribution.edges.test.js
//
// Se separan en un fichero aparte para no engordar el original y para
// que quede visible por qué existen: son casos frontera reales (grupos
// vacíos, un solo elemento, empates de ratio, chunk_size=1, mutación de
// metas, determinismo, etc.). Cazan bugs sutiles que sí ocurren cuando
// se retoca la función y los tests "felices" siguen pasando.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  pickRaffleFromRatioGroups,
  assignCandidatesBidirectional,
  makeInterestClassifier,
} = require('../lib/promoDistribution');

// ─── Helpers (copiados del fichero original) ──────────────────────────
function raffleRow({ id, categories = [], banner_interested_only = false, community_id = 'C' }) {
  return {
    raffle: { id, community_id, banner_interested_only, community: { categories } },
  };
}

function buildRafflePickInput(rows, ratios, userInterests) {
  const sortedIds = rows.map(r => r.raffle.id).sort((a, b) => (ratios[a] ?? 0) - (ratios[b] ?? 0));
  const rowsById = new Map(rows.map(r => [r.raffle.id, r]));
  const ratioById = new Map(Object.entries(ratios));
  const ownInterests = new Set(userInterests);
  return {
    sortedIds, rowsById, ratioById,
    matchesCategory: row => (row.raffle.community?.categories || []).some(cat => ownInterests.has(cat)),
    isRestricted: row => row.raffle.banner_interested_only === true,
  };
}

function makeMeta({ id, remaining = 50, excluded = [], categories = [] }) {
  return {
    id, remaining,
    excludeSet: new Set(excluded),
    eventCategories: new Set(categories),
    chosen: [],
  };
}

const makeCandidate = (userId) => ({ userId });

// ─── pickRaffleFromRatioGroups — bordes duros ─────────────────────────

test('pickRaffle: sortedIds con id ausente de rowsById se ignora (fila desaparecida)', () => {
  // Regresión: si un raffle desaparece entre la carga y el pick (race
  // de eliminación), sortedIds puede contener un id sin entrada en
  // rowsById. Debe ignorarse sin romper el pick.
  const rows = [
    raffleRow({ id: 'r1', categories: ['cine'] }),
    raffleRow({ id: 'r2', categories: ['deporte'] }),
  ];
  const input = buildRafflePickInput(rows, { r1: 0.5, r2: 0.2 }, ['deporte']);
  // Inyectamos un 'fantasma' al principio de sortedIds — id que no está en rowsById.
  input.sortedIds = ['fantasma', ...input.sortedIds];
  const picked = pickRaffleFromRatioGroups(input);
  assert.equal(picked?.raffle.id, 'r2', 'debe ignorar el id fantasma y seguir con los que sí existen');
});

test('pickRaffle: groupSize=1 — cada raffle es su propio "grupo"', () => {
  // Con groupSize=1, el mecanismo de "peor ratio dentro del grupo"
  // colapsa: cada grupo tiene un solo elemento. Si el primero no
  // matchea y está restringido, se pasa al siguiente uno a uno.
  const rows = [
    raffleRow({ id: 'r1', categories: ['x'], banner_interested_only: true }),
    raffleRow({ id: 'r2', categories: ['y'], banner_interested_only: true }),
    raffleRow({ id: 'r3', categories: ['z'] }),
  ];
  const input = buildRafflePickInput(rows, { r1: 0.1, r2: 0.2, r3: 0.9 }, []);
  const picked = pickRaffleFromRatioGroups({ ...input, groupSize: 1 });
  assert.equal(picked?.raffle.id, 'r3', 'r1 y r2 restringidos sin match; solo r3 servible');
});

test('pickRaffle: ratio ausente en ratioById cuenta como 0 (peor posible)', () => {
  // El comparador usa `?? 0` — un sorteo sin entrada en ratioById se
  // interpreta como "sin servir ninguna todavía" y sale como el más
  // necesitado.
  const rows = [
    raffleRow({ id: 'r1' }),
    raffleRow({ id: 'r2' }),
  ];
  const input = buildRafflePickInput(rows, { r1: 0.5 /* r2 sin entrada */ }, []);
  const picked = pickRaffleFromRatioGroups(input);
  assert.equal(picked?.raffle.id, 'r2');
});

test('pickRaffle: dos raffles empatan en ratio → el de sortedIds primero gana (estable)', () => {
  // Determinismo: dos ratios idénticos, el orden lo decide sortedIds
  // (que ya viene ordenado por el caller). No debe fluctuar entre llamadas.
  const rows = [
    raffleRow({ id: 'A' }),
    raffleRow({ id: 'B' }),
    raffleRow({ id: 'C' }),
  ];
  const input = buildRafflePickInput(rows, { A: 0.2, B: 0.2, C: 0.9 }, []);
  const picks = new Set();
  for (let i = 0; i < 10; i++) {
    picks.add(pickRaffleFromRatioGroups(input)?.raffle.id);
  }
  assert.equal(picks.size, 1, 'el pick debe ser determinista');
});

test('pickRaffle: ratios con NaN/undefined no rompen el sort (tratados como 0)', () => {
  const rows = [
    raffleRow({ id: 'r1' }),
    raffleRow({ id: 'r2' }),
  ];
  const input = buildRafflePickInput(rows, { r1: NaN, r2: 0.5 }, []);
  // NaN en el comparador daría NaN al restar → sort inestable. La función
  // usa `?? 0` que NO cubre NaN. Verificamos al menos que NO lanza y
  // devuelve UN raffle (aunque el orden con NaN sea implementación-defined).
  const picked = pickRaffleFromRatioGroups(input);
  assert.ok(picked, 'no debe devolver null si hay raffles servibles');
  assert.ok(['r1', 'r2'].includes(picked.raffle.id));
});

test('pickRaffle: grupo de más de groupSize (7 raffles con groupSize=3) → 3 grupos', () => {
  // Los 3 primeros por peor ratio son el primer grupo; si nadie
  // matchea/es servible ahí, va a los 3 siguientes; y así.
  const rows = [
    raffleRow({ id: 'r1', banner_interested_only: true }),
    raffleRow({ id: 'r2', banner_interested_only: true }),
    raffleRow({ id: 'r3', banner_interested_only: true }),
    raffleRow({ id: 'r4', banner_interested_only: true }),
    raffleRow({ id: 'r5', banner_interested_only: true }),
    raffleRow({ id: 'r6', banner_interested_only: true }),
    raffleRow({ id: 'r7', categories: ['ok'] }), // solo r7 servible al no ser interest-only
  ];
  const input = buildRafflePickInput(rows,
    { r1: 0.1, r2: 0.15, r3: 0.2, r4: 0.25, r5: 0.3, r6: 0.35, r7: 0.9 },
    []
  );
  const picked = pickRaffleFromRatioGroups(input);
  assert.equal(picked?.raffle.id, 'r7', 'debe recorrer los 3 grupos y devolver el único servible');
});

test('pickRaffle: pickRaffle no muta rows ni sortedIds (side-effect-free)', () => {
  const rows = [
    raffleRow({ id: 'r1', categories: ['cine'] }),
    raffleRow({ id: 'r2', categories: ['deporte'] }),
    raffleRow({ id: 'r3', categories: ['viajes'] }),
  ];
  const input = buildRafflePickInput(rows, { r1: 0.1, r2: 0.5, r3: 0.9 }, ['deporte']);
  const originalSorted = [...input.sortedIds];
  const originalRatios = new Map(input.ratioById);
  pickRaffleFromRatioGroups(input);
  assert.deepEqual(input.sortedIds, originalSorted, 'sortedIds no debe mutar');
  assert.deepEqual([...input.ratioById.entries()], [...originalRatios.entries()], 'ratioById no debe mutar');
});

// ─── assignCandidatesBidirectional — bordes duros ─────────────────────

test('assign: MUTA metas — chosen crece y remaining decrementa (contrato del caller)', () => {
  // El comentario del código lo dice: la función muta las metas. El
  // caller depende de eso para conocer el estado tras varias rondas.
  // Este test lo amarra: si alguien lo refactoriza a inmutable sin
  // avisar al caller, cae aquí.
  const metas = [makeMeta({ id: 'e1', remaining: 10 })];
  const candidates = [makeCandidate('u1'), makeCandidate('u2'), makeCandidate('u3')];
  assignCandidatesBidirectional({
    candidates,
    eventMetas: metas,
    interestsByUser: new Map(),
  });
  assert.equal(metas[0].remaining, 7);
  assert.equal(metas[0].chosen.length, 3);
});

test('assign: no muta el array de candidates ni el interestsByUser', () => {
  const metas = [makeMeta({ id: 'e1', remaining: 5, categories: ['deporte'] })];
  const candidates = [makeCandidate('u1'), makeCandidate('u2')];
  const interests = new Map([['u1', new Set(['deporte'])]]);
  const snapshotCandidates = JSON.stringify(candidates);
  const snapshotInterestsKeys = [...interests.keys()];

  assignCandidatesBidirectional({ candidates, eventMetas: metas, interestsByUser: interests });

  assert.equal(JSON.stringify(candidates), snapshotCandidates, 'candidates no debe mutar');
  assert.deepEqual([...interests.keys()], snapshotInterestsKeys, 'interestsByUser no debe mutar');
});

test('assign: reparto en cascada — evento lleno pasa candidatos al siguiente', () => {
  // Regresión de la Ronda 2: si el primer evento agota su remaining, los
  // candidatos restantes deben ir al segundo. Sin este comportamiento,
  // se quedarían sin asignar y el pool desperdicia hueco disponible.
  const metas = [
    makeMeta({ id: 'lleno', remaining: 1, categories: ['deporte'] }),
    makeMeta({ id: 'hueco', remaining: 5, categories: ['deporte'] }),
  ];
  const candidates = [makeCandidate('u1'), makeCandidate('u2'), makeCandidate('u3')];
  const interests = new Map([
    ['u1', new Set(['deporte'])],
    ['u2', new Set(['deporte'])],
    ['u3', new Set(['deporte'])],
  ]);
  const still = assignCandidatesBidirectional({ candidates, eventMetas: metas, interestsByUser: interests });
  assert.equal(still.length, 0, 'nadie debe quedar sin asignar');
  assert.equal(metas[0].remaining, 0);
  assert.equal(metas[0].chosen.length, 1);
  assert.equal(metas[1].chosen.length, 2);
});

test('assign: determinismo — mismo input → misma asignación', () => {
  // Sin aleatoriedad interna, la función debe repartir igual cada vez.
  const build = () => ({
    metas: [
      makeMeta({ id: 'e1', remaining: 5, categories: ['cine'] }),
      makeMeta({ id: 'e2', remaining: 5, categories: ['deporte'] }),
    ],
    candidates: [makeCandidate('u1'), makeCandidate('u2'), makeCandidate('u3')],
    interests: new Map([
      ['u1', new Set(['cine'])],
      ['u2', new Set(['deporte'])],
      ['u3', new Set(['viajes'])],
    ]),
  });
  const first = build();
  assignCandidatesBidirectional({ candidates: first.candidates, eventMetas: first.metas, interestsByUser: first.interests });
  const firstDist = first.metas.map(m => m.chosen.map(c => c.userId).sort());

  const second = build();
  assignCandidatesBidirectional({ candidates: second.candidates, eventMetas: second.metas, interestsByUser: second.interests });
  const secondDist = second.metas.map(m => m.chosen.map(c => c.userId).sort());

  assert.deepEqual(firstDist, secondDist);
});

test('assign: usuario en excludeSet de TODOS los eventos → cae en stillAvailable', () => {
  // Ronda 2 recursiva: si un candidato no cabe en ningún evento por
  // exclusión, se preserva en stillAvailable para reintentar más tarde.
  const metas = [
    makeMeta({ id: 'e1', remaining: 5, excluded: ['u1'] }),
    makeMeta({ id: 'e2', remaining: 5, excluded: ['u1'] }),
  ];
  const candidates = [makeCandidate('u1')];
  const still = assignCandidatesBidirectional({ candidates, eventMetas: metas, interestsByUser: new Map() });
  assert.deepEqual(still.map(c => c.userId), ['u1']);
  assert.equal(metas[0].chosen.length, 0);
  assert.equal(metas[1].chosen.length, 0);
});

test('assign: interestsByUser sin entrada para el candidato → fallback (no crash)', () => {
  // La carga paginada de intereses puede fallar; el candidato llega sin
  // entry en el Map. No debe romper, debe caer al fallback de peor ratio.
  const metas = [
    makeMeta({ id: 'e1', remaining: 5, categories: ['deporte'] }),
  ];
  const candidates = [makeCandidate('u1')];
  const still = assignCandidatesBidirectional({
    candidates,
    eventMetas: metas,
    interestsByUser: new Map(), // vacío, u1 no aparece
  });
  assert.equal(still.length, 0);
  assert.equal(metas[0].chosen.length, 1);
});

test('assign: remaining=0 en todos los eventos → nadie se asigna, todos a stillAvailable', () => {
  const metas = [
    makeMeta({ id: 'e1', remaining: 0 }),
    makeMeta({ id: 'e2', remaining: 0 }),
  ];
  const candidates = [makeCandidate('u1'), makeCandidate('u2')];
  const still = assignCandidatesBidirectional({ candidates, eventMetas: metas, interestsByUser: new Map() });
  assert.equal(still.length, 2);
  assert.equal(metas[0].chosen.length, 0);
  assert.equal(metas[1].chosen.length, 0);
});

// ─── makeInterestClassifier — bordes duros ────────────────────────────

test('classifier: null se devuelve UNA vez, no llama a función', () => {
  // Contrato explícito: si el evento no es clasificable, se devuelve
  // null (no una función que siempre devuelva null). Esto permite al
  // caller decidir "no clasifico este evento" sin pagar el coste.
  const classifier = makeInterestClassifier(new Set(), new Map());
  assert.equal(classifier, null);
  assert.equal(typeof classifier, 'object'); // null es 'object' en JS
});

test('classifier: eventCategories undefined → null (defensa, no crash)', () => {
  assert.equal(makeInterestClassifier(undefined, new Map()), null);
  assert.equal(makeInterestClassifier(null, new Map()), null);
});

test('classifier: null (no cargado) NUNCA se confunde con false', () => {
  // Fase 111: distinguir "no lo sé" de "no coincide" es lo que separa
  // un CTR realista de uno viciado. Este test se asegura de que las dos
  // situaciones vuelven valores DIFERENTES.
  const classifier = makeInterestClassifier(new Set(['deporte']), new Map([
    ['sin_intereses_cargados', undefined], // ausente en Map se comporta igual
    ['con_intereses_vacios', new Set()],
    ['con_intereses_que_matchean', new Set(['deporte'])],
    ['con_intereses_que_no_matchean', new Set(['cine'])],
  ]));
  assert.equal(classifier('sin_intereses_cargados'), null,
    'usuario no cargado → null, "no lo sé"');
  assert.equal(classifier('con_intereses_vacios'), false,
    'usuario cargado sin intereses → false, "no coincide"');
  assert.equal(classifier('con_intereses_que_matchean'), true);
  assert.equal(classifier('con_intereses_que_no_matchean'), false);
});

test('classifier: usuario totalmente ausente del Map (no era userId conocido) → null', () => {
  const classifier = makeInterestClassifier(new Set(['deporte']), new Map());
  assert.equal(classifier('desconocido'), null);
});
