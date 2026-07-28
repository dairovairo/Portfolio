// Tests unitarios de server/lib/rafflePicker.js — lógica pura de elegir
// qué "avioneta" de sorteo mostrar cuando el usuario tiene varios
// pendientes. Correr con:
//
//   node --test server/test/rafflePicker.test.js
//
// Extraída de routes/community.js:pickWithinTier para poder testearla
// sin Supabase.
//
// Reglas cubiertas (en el orden en que decide):
//   1. Match por pertenencia — si alguno es de tu comunidad, gana ese.
//   2. Match por intereses en grupos de 3 (solo Volt / Light).
//      2b. banner_interested_only descarta sorteos si no matcheas.
//      2c. Si el grupo entero es interest-restricted y no matcheas,
//          se salta al siguiente grupo de 3.
//   3. Fallback: primer sorteo por orden cronológico.

const test = require('node:test');
const assert = require('node:assert/strict');

const { pickWithinTier, computeRaffleRatios } = require('../lib/rafflePicker');

// Helpers: construir "row" con la forma que espera pickWithinTier.
function row(id, {
  communityId = 'C-other',
  categories = [],
  interestedOnly = false,
  createdAt = '2026-01-01T00:00:00Z',
} = {}) {
  return {
    raffle: {
      id,
      community_id: communityId,
      banner_interested_only: interestedOnly,
      community: { categories },
    },
    created_at: createdAt,
  };
}

// ─── Regla 1: comunidad propia gana ───────────────────────────────────
test('regla 1: si un sorteo es de tu comunidad, gana sin importar tier ni intereses', () => {
  const rows = [
    row('r1', { communityId: 'C-otra' }),
    row('r2', { communityId: 'C-mia' }),
    row('r3', { communityId: 'C-otra' }),
  ];
  const pick = pickWithinTier({
    tier: 'light',
    rows,
    ownCommunityIds: new Set(['C-mia']),
    ownInterests: new Set(),
    sortedIds: ['r1', 'r2', 'r3'],
    ratioById: new Map([['r1', 0], ['r2', 0.9], ['r3', 0]]),
    boostGroupSize: 3,
  });
  assert.equal(pick.raffle.id, 'r2');
});

test('regla 1: la comunidad propia gana AUNQUE tenga interest-only y tú no matches', () => {
  // La regla de "es tu comunidad" es más fuerte que cualquier filtro.
  const rows = [
    row('r1'),
    row('r2', { communityId: 'C-mia', interestedOnly: true, categories: ['viajes'] }),
  ];
  const pick = pickWithinTier({
    tier: 'light',
    rows,
    ownCommunityIds: new Set(['C-mia']),
    ownInterests: new Set(['cine']),
    sortedIds: ['r1', 'r2'],
    ratioById: new Map([['r1', 0], ['r2', 0]]),
    boostGroupSize: 3,
  });
  assert.equal(pick.raffle.id, 'r2');
});

// ─── Regla 2: match de intereses en grupos de 3 ───────────────────────
test('regla 2: en Light, dentro del grupo de 3 gana el que matchea intereses', () => {
  // Grupo por ratio: [r1, r2, r3]. r2 matchea intereses del usuario.
  const rows = [
    row('r1', { categories: ['deportes'] }),
    row('r2', { categories: ['cine'] }),
    row('r3', { categories: ['música'] }),
  ];
  const pick = pickWithinTier({
    tier: 'light',
    rows,
    ownCommunityIds: new Set(),
    ownInterests: new Set(['cine']),
    sortedIds: ['r1', 'r2', 'r3'],
    ratioById: new Map([['r1', 0.1], ['r2', 0.5], ['r3', 0.9]]),
    boostGroupSize: 3,
  });
  assert.equal(pick.raffle.id, 'r2');
});

test('regla 2: si varios matchean, gana el de PEOR ratio (más necesitado)', () => {
  const rows = [
    row('r1', { categories: ['cine'] }),
    row('r2', { categories: ['cine'] }),
    row('r3', { categories: ['música'] }),
  ];
  const pick = pickWithinTier({
    tier: 'light',
    rows,
    ownCommunityIds: new Set(),
    ownInterests: new Set(['cine']),
    // r1 tiene mejor ratio (más servido) que r2 → r1 es "menos
    // necesitado", así que gana r2.
    sortedIds: ['r2', 'r1', 'r3'],
    ratioById: new Map([['r1', 0.5], ['r2', 0.1], ['r3', 0.9]]),
    boostGroupSize: 3,
  });
  assert.equal(pick.raffle.id, 'r2');
});

test('regla 2: sin match de intereses, gana el de peor ratio servible del grupo', () => {
  // Ningún sorteo matchea con "cine". Ninguno es interest-only, así que
  // todos son "servibles". Gana el de peor ratio dentro del grupo.
  const rows = [
    row('r1', { categories: ['deportes'] }),
    row('r2', { categories: ['música'] }),
    row('r3', { categories: ['libros'] }),
  ];
  const pick = pickWithinTier({
    tier: 'light',
    rows,
    ownCommunityIds: new Set(),
    ownInterests: new Set(['cine']),
    sortedIds: ['r1', 'r2', 'r3'],
    ratioById: new Map([['r1', 0.1], ['r2', 0.5], ['r3', 0.9]]),
    boostGroupSize: 3,
  });
  // El peor ratio (0.1) es r1 — más necesitado, gana.
  assert.equal(pick.raffle.id, 'r1');
});

test('regla 2b: interest-only descarta sorteos si no matcheas', () => {
  // r1 y r2 son interest-only y no matcheo → se descartan. Queda r3.
  const rows = [
    row('r1', { categories: ['deportes'], interestedOnly: true }),
    row('r2', { categories: ['música'], interestedOnly: true }),
    row('r3', { categories: ['libros'] }),
  ];
  const pick = pickWithinTier({
    tier: 'light',
    rows,
    ownCommunityIds: new Set(),
    ownInterests: new Set(['cine']),
    sortedIds: ['r1', 'r2', 'r3'],
    ratioById: new Map([['r1', 0.1], ['r2', 0.2], ['r3', 0.9]]),
    boostGroupSize: 3,
  });
  assert.equal(pick.raffle.id, 'r3');
});

test('regla 2c: grupo entero interest-only y no matcheo → salta al siguiente grupo de 3', () => {
  // Grupo 1: r1, r2, r3 — todos interest-only, ninguno matchea.
  // Grupo 2: r4, r5 — no restringido, r4 tiene peor ratio.
  const rows = [
    row('r1', { categories: ['deportes'], interestedOnly: true }),
    row('r2', { categories: ['música'], interestedOnly: true }),
    row('r3', { categories: ['libros'], interestedOnly: true }),
    row('r4', { categories: ['viajes'] }),
    row('r5', { categories: ['gaming'] }),
  ];
  const pick = pickWithinTier({
    tier: 'light',
    rows,
    ownCommunityIds: new Set(),
    ownInterests: new Set(['cine']),
    sortedIds: ['r1', 'r2', 'r3', 'r4', 'r5'],
    ratioById: new Map([['r1', 0.1], ['r2', 0.1], ['r3', 0.1], ['r4', 0.4], ['r5', 0.5]]),
    boostGroupSize: 3,
  });
  assert.equal(pick.raffle.id, 'r4');
});

test('regla 2 no aplica en tier community (fallback directo)', () => {
  // 'community' no participa del mecanismo de grupos — cae siempre a
  // rows[0].
  const rows = [
    row('r1', { categories: ['deportes'] }),
    row('r2', { categories: ['cine'] }),
  ];
  const pick = pickWithinTier({
    tier: 'community',
    rows,
    ownCommunityIds: new Set(),
    ownInterests: new Set(['cine']),
    sortedIds: ['r2', 'r1'],
    ratioById: new Map([['r1', 0.9], ['r2', 0.1]]),
    boostGroupSize: 3,
  });
  assert.equal(pick.raffle.id, 'r1'); // rows[0]
});

test('regla 2 no aplica si el usuario no tiene intereses declarados', () => {
  const rows = [
    row('r1', { categories: ['deportes'] }),
    row('r2', { categories: ['cine'] }),
  ];
  const pick = pickWithinTier({
    tier: 'light',
    rows,
    ownCommunityIds: new Set(),
    ownInterests: new Set(), // vacío
    sortedIds: ['r2', 'r1'],
    ratioById: new Map([['r1', 0.9], ['r2', 0.1]]),
    boostGroupSize: 3,
  });
  // Cae al fallback → rows[0]
  assert.equal(pick.raffle.id, 'r1');
});

// ─── Regla 3: fallback ────────────────────────────────────────────────
test('regla 3: sin match ninguno y sin restricción, gana rows[0]', () => {
  // Con tier='volt' pero sin intereses del usuario → no entra en la
  // rama boostable → rows[0].
  const rows = [row('r1'), row('r2')];
  const pick = pickWithinTier({
    tier: 'volt',
    rows,
    ownCommunityIds: new Set(),
    ownInterests: new Set(),
    sortedIds: ['r1', 'r2'],
    ratioById: new Map([['r1', 0.9], ['r2', 0.1]]),
    boostGroupSize: 3,
  });
  assert.equal(pick.raffle.id, 'r1');
});

test('robustez: rows vacío → null', () => {
  const pick = pickWithinTier({
    tier: 'light',
    rows: [],
    ownCommunityIds: new Set(),
    ownInterests: new Set(),
    sortedIds: [],
    ratioById: new Map(),
    boostGroupSize: 3,
  });
  assert.equal(pick, null);
});

test('robustez: rows null/undefined → null', () => {
  const base = {
    tier: 'light',
    ownCommunityIds: new Set(),
    ownInterests: new Set(),
    sortedIds: [],
    ratioById: new Map(),
    boostGroupSize: 3,
  };
  assert.equal(pickWithinTier({ ...base, rows: null }), null);
  assert.equal(pickWithinTier({ ...base, rows: undefined }), null);
});

// ─── computeRaffleRatios ──────────────────────────────────────────────
test('ratios: light usa shown/contracted (más bajo = más necesitado)', () => {
  const { sortedIds, ratioById } = computeRaffleRatios({
    tier: 'light',
    raffles: [
      { id: 'r1', banner_views_contracted: 1000 },
      { id: 'r2', banner_views_contracted: 100 },
    ],
    shownCountById: new Map([['r1', 100], ['r2', 50]]),
  });
  // r1: 100/1000 = 0.1 (más necesitado)
  // r2: 50/100 = 0.5
  assert.deepEqual(sortedIds, ['r1', 'r2']);
  assert.equal(ratioById.get('r1'), 0.1);
  assert.equal(ratioById.get('r2'), 0.5);
});

test('ratios: volt no tiene contracted → usa shown en crudo', () => {
  const { sortedIds, ratioById } = computeRaffleRatios({
    tier: 'volt',
    raffles: [
      { id: 'r1' },
      { id: 'r2' },
      { id: 'r3' },
    ],
    shownCountById: new Map([['r1', 50], ['r2', 10], ['r3', 200]]),
  });
  // Menos servido = más necesitado → r2, r1, r3
  assert.deepEqual(sortedIds, ['r2', 'r1', 'r3']);
});

test('ratios: un solo sorteo → sortedIds tiene ese id con ratio 0', () => {
  const { sortedIds, ratioById } = computeRaffleRatios({
    tier: 'light',
    raffles: [{ id: 'solo', banner_views_contracted: 1000 }],
    shownCountById: new Map([['solo', 500]]),
  });
  assert.deepEqual(sortedIds, ['solo']);
  assert.equal(ratioById.get('solo'), 0);
});

test('ratios: sin raffles → estructura vacía', () => {
  const { sortedIds, ratioById } = computeRaffleRatios({
    tier: 'light',
    raffles: [],
    shownCountById: new Map(),
  });
  assert.deepEqual(sortedIds, []);
  assert.equal(ratioById.size, 0);
});

test('ratios: shownCountById sin entrada para un raffle → cuenta como 0', () => {
  const { sortedIds } = computeRaffleRatios({
    tier: 'volt',
    raffles: [
      { id: 'r1' }, // ausente en el Map
      { id: 'r2' },
    ],
    shownCountById: new Map([['r2', 5]]),
  });
  // r1 tiene 0 servidas → más necesitado que r2
  assert.deepEqual(sortedIds, ['r1', 'r2']);
});
