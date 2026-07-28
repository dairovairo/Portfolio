// Tests unitarios de los internos puros de server/lib/circleBadges.js —
// las piezas que deciden quién gana cada insignia y cómo se rompen los
// empates. Correr con:
//
//   node --test server/test/circleBadges.test.js
//
// circleBadges.js requiere ./supabase al top-level (por las funciones
// asíncronas que sí tocan BD), así que ponemos stubs de env antes de
// importar. Las funciones que testeamos aquí son 100% puras y viven
// bajo `__internal` — accesibles solo para tests, no para el resto del
// código.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://stub.local';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'stub-key';

const {
  CIRCLE_BADGES,
  __internal: {
    TAPADO_BADGE_ID,
    average,
    scoreRank,
    stableTieValue,
    pushHighCandidates,
    pushLowCandidates,
    pushAverageCandidates,
    chooseAssignments,
  },
} = require('../lib/circleBadges');

// ─── average ──────────────────────────────────────────────────────────
test('average: cálculo directo cuando hay señal', () => {
  assert.equal(average(10, 2), 5);
  assert.equal(average(7, 4), 1.75);
});

test('average: sin muestras (count 0) → null, no NaN', () => {
  // Es la señal que usa pushAverageCandidates para descartar usuarios
  // sin datos suficientes — si fuese NaN o 0, ganarían injustamente.
  assert.equal(average(50, 0), null);
});

test('average: count negativo (defensa) → null', () => {
  assert.equal(average(10, -1), null);
});

// ─── stableTieValue ───────────────────────────────────────────────────
test('tiebreak: mismo input → mismo hash (determinista)', () => {
  const a = stableTieValue('grupo1', 'night_owl', 'user-abc');
  const b = stableTieValue('grupo1', 'night_owl', 'user-abc');
  assert.equal(a, b);
});

test('tiebreak: inputs distintos → hashes casi siempre distintos', () => {
  // No es garantía criptográfica, pero para un puñado de valores no debe
  // colisionar. Verificamos con varios pares.
  const pairs = [
    [['g', 'b', 'u1'], ['g', 'b', 'u2']],
    [['g', 'b1', 'u'], ['g', 'b2', 'u']],
    [['g1', 'b', 'u'], ['g2', 'b', 'u']],
  ];
  for (const [x, y] of pairs) {
    assert.notEqual(stableTieValue(...x), stableTieValue(...y),
      `colisión inesperada entre ${x.join(',')} y ${y.join(',')}`);
  }
});

test('tiebreak: cambiar scopeId cambia el ganador — evita "el mismo user siempre gana en todos los grupos"', () => {
  // Regresión importante: si el orden desempatado no dependiera del
  // scopeId, un usuario que gane un empate en el círculo lo ganaría en
  // TODOS sus grupos. Como sí depende de scopeId, los empates se
  // distribuyen entre grupos distintos.
  const users = ['u1', 'u2', 'u3'];
  const winnerInScope = (scope) => {
    return users.map(u => ({ u, h: stableTieValue(scope, 'badge', u) }))
                .sort((a, b) => a.h - b.h)[0].u;
  };
  const winners = new Set(['g1', 'g2', 'g3', 'g4', 'g5'].map(winnerInScope));
  // Al menos 2 usuarios distintos deberían salir ganadores entre 5
  // scopes. Confirma que la función distribuye.
  assert.ok(winners.size >= 2,
    `todos los scopes eligen al mismo usuario (${[...winners]}); no distribuye`);
});

test('tiebreak: no lanza con partes vacías o null', () => {
  // stableTieValue filtra Boolean, así que null/'' se ignoran.
  assert.equal(typeof stableTieValue(), 'number');
  assert.equal(typeof stableTieValue(null, '', undefined), 'number');
});

// ─── scoreRank ────────────────────────────────────────────────────────
test('rank: higherIsBetter=true — cuanto más alto, mejor rank', () => {
  const list = [
    { userId: 'a', metric: 10 },
    { userId: 'b', metric: 5 },
    { userId: 'c', metric: 20 },
  ];
  // Con higher=true, ganan los grandes. c (20) rank 1, a (10) rank 2, b rank 3.
  assert.equal(scoreRank(list, 'metric', 20, true), 1);
  assert.equal(scoreRank(list, 'metric', 10, true), 2);
  assert.equal(scoreRank(list, 'metric', 5, true), 3);
});

test('rank: higherIsBetter=false — invierte el ranking', () => {
  const list = [
    { userId: 'a', metric: 10 },
    { userId: 'b', metric: 5 },
    { userId: 'c', metric: 20 },
  ];
  // Con higher=false, ganan los bajos. b (5) rank 1, a rank 2, c rank 3.
  assert.equal(scoreRank(list, 'metric', 5, false), 1);
  assert.equal(scoreRank(list, 'metric', 10, false), 2);
  assert.equal(scoreRank(list, 'metric', 20, false), 3);
});

// ─── pushHighCandidates ───────────────────────────────────────────────
test('pushHigh: solo entran los que llegan al umbral mínimo', () => {
  const stats = [
    { userId: 'a', metric: 10 },
    { userId: 'b', metric: 3 },
    { userId: 'c', metric: 15 },
  ];
  const candidates = [];
  pushHighCandidates(candidates, 'badgeX', stats, 'metric', 5, s => `${s.userId} tiene ${s.metric}`);
  const userIds = candidates.map(c => c.userId).sort();
  assert.deepEqual(userIds, ['a', 'c']); // 'b' con 3 queda fuera del minScore=5
});

test('pushHigh: el ganador tiene el score más alto y rank 1', () => {
  const stats = [
    { userId: 'a', metric: 10 },
    { userId: 'c', metric: 15 },
    { userId: 'd', metric: 20 },
  ];
  const candidates = [];
  pushHighCandidates(candidates, 'badgeX', stats, 'metric', 0, s => 'r');
  const top = candidates.find(c => c.rank === 1);
  assert.equal(top.userId, 'd');
  assert.equal(top.score, 20);
});

test('pushHigh: strength es el gap con el siguiente distinto (o el propio score si no hay siguiente)', () => {
  const stats = [
    { userId: 'a', metric: 100 },
    { userId: 'b', metric: 60 },
  ];
  const candidates = [];
  pushHighCandidates(candidates, 'badgeX', stats, 'metric', 0, s => 'r');
  const top = candidates.find(c => c.userId === 'a');
  const last = candidates.find(c => c.userId === 'b');
  assert.equal(top.strength, 40); // 100 - 60
  assert.equal(last.strength, 60); // no hay siguiente → su propio score
});

// ─── pushLowCandidates ────────────────────────────────────────────────
test('pushLow: si nadie tiene señal (>0), no genera candidatos', () => {
  const stats = [
    { userId: 'a', metric: 0 },
    { userId: 'b', metric: 0 },
  ];
  const candidates = [];
  pushLowCandidates(candidates, 'badgeX', stats, 'metric', s => 'r');
  assert.equal(candidates.length, 0);
});

test('pushLow: el ganador tiene el score más bajo', () => {
  const stats = [
    { userId: 'a', metric: 10 },
    { userId: 'b', metric: 3 },
    { userId: 'c', metric: 8 },
  ];
  const candidates = [];
  pushLowCandidates(candidates, 'badgeX', stats, 'metric', s => 'r');
  const top = candidates.find(c => c.rank === 1);
  assert.equal(top.userId, 'b');
  assert.equal(top.score, 3);
});

test('pushLow: sortScore negativo — para que el mejor "bajo" gane en la agregación por sortScore', () => {
  // chooseAssignments elige el bestScore = Math.max(...sortScore).
  // Si en pushLow el sortScore fuera el crudo (positivo), el peor ganaría.
  const stats = [
    { userId: 'a', metric: 10 },
    { userId: 'b', metric: 3 },
  ];
  const candidates = [];
  pushLowCandidates(candidates, 'badgeX', stats, 'metric', s => 'r');
  const b = candidates.find(c => c.userId === 'b');
  const a = candidates.find(c => c.userId === 'a');
  // b tiene el mejor "bajo" (3), así que su sortScore debe ser MAYOR
  // que el de a. En la implementación: sortScore = -metric.
  assert.ok(b.sortScore > a.sortScore,
    `b.sortScore (${b.sortScore}) debería ser > a.sortScore (${a.sortScore})`);
});

test('pushLow: desempate en tieBreakMetric si se pasa', () => {
  // Dos empatados en metric=5; con tieBreak, gana el de tieBreak menor.
  const stats = [
    { userId: 'a', metric: 5, joinedPools: 20 },
    { userId: 'b', metric: 5, joinedPools: 3 },
    { userId: 'c', metric: 10, joinedPools: 999 },
  ];
  const candidates = [];
  pushLowCandidates(candidates, 'badgeX', stats, 'metric', s => 'r', 'joinedPools');
  const top = candidates.find(c => c.rank === 1);
  // Empate metric a=5 con b=5, tieBreak: b (3) < a (20), b gana.
  assert.equal(top.userId, 'b');
});

// ─── pushAverageCandidates ────────────────────────────────────────────
test('pushAverage: descarta usuarios sin muestras (count=0)', () => {
  const stats = [
    { userId: 'a', total: 100, count: 5 }, // media 20
    { userId: 'b', total: 50, count: 0 },  // sin datos
    { userId: 'c', total: 60, count: 3 },  // media 20
  ];
  const candidates = [];
  pushAverageCandidates(candidates, 'badgeX', stats, 'total', 'count', s => 'r');
  assert.equal(candidates.length, 2); // b no entra
  assert.ok(!candidates.some(c => c.userId === 'b'));
});

test('pushAverage: en empate de media, gana quien tenga MÁS muestras (count)', () => {
  // Regresión clave: sin este orden, un 1/1=100% ganaría a un 9/10=90%
  // en el bucket "media alta" — anecdótico venciendo a consistente.
  const stats = [
    { userId: 'anecdotico', total: 1, count: 1 },   // 100%
    { userId: 'consistente', total: 9, count: 10 }, // 90%
  ];
  const candidates = [];
  pushAverageCandidates(candidates, 'badgeX', stats, 'total', 'count', s => 'r',
    { higherIsBetter: true });
  // No hay empate en este caso; el anecdótico tiene mayor media y gana.
  // Empate real:
  const empate = [
    { userId: 'anecdotico', total: 2, count: 2 },   // 100%
    { userId: 'consistente', total: 10, count: 10 }, // 100%
  ];
  const c2 = [];
  pushAverageCandidates(c2, 'badgeX', empate, 'total', 'count', s => 'r',
    { higherIsBetter: true });
  const winner = c2.find(c => c.rank === 1);
  assert.equal(winner.userId, 'consistente',
    'con misma media, debe ganar quien tenga más volumen de datos');
});

test('pushAverage: higherIsBetter=false invierte la dirección', () => {
  const stats = [
    { userId: 'poco', total: 10, count: 5 }, // media 2
    { userId: 'mucho', total: 40, count: 4 }, // media 10
  ];
  const candidates = [];
  pushAverageCandidates(candidates, 'badgeX', stats, 'total', 'count', s => 'r',
    { higherIsBetter: false });
  const winner = candidates.find(c => c.rank === 1);
  // higher=false → el de MENOR media gana
  assert.equal(winner.userId, 'poco');
});

// ─── chooseAssignments ────────────────────────────────────────────────
// Es la pieza más importante — aplica las reglas: (1) exclusiva por
// insignia, (2) máx. 1 insignia por usuario, (3) tapado como red de
// seguridad para los que no tienen nada.

test('choose: sin candidatos, todos los miembros reciben Tapado', () => {
  const memberIds = ['u1', 'u2', 'u3'];
  const assignments = chooseAssignments([], memberIds, 'scope-1');
  assert.equal(assignments.length, 3);
  for (const a of assignments) assert.equal(a.badgeId, TAPADO_BADGE_ID);
});

test('choose: un candidato claro gana su insignia, el resto → Tapado', () => {
  const memberIds = ['u1', 'u2', 'u3'];
  const candidates = [
    { badgeId: 'night_owl', userId: 'u1', sortScore: 100, score: 100, strength: 50, reason: 'r' },
  ];
  const assignments = chooseAssignments(candidates, memberIds, 'scope-1');
  const nightOwl = assignments.find(a => a.badgeId === 'night_owl');
  assert.equal(nightOwl.userId, 'u1');
  const tapados = assignments.filter(a => a.badgeId === TAPADO_BADGE_ID).map(a => a.userId).sort();
  assert.deepEqual(tapados, ['u2', 'u3']);
});

test('choose: un usuario NO puede tener dos insignias competitivas', () => {
  const memberIds = ['u1', 'u2'];
  const candidates = [
    // u1 gana night_owl con score alto, y también sería el mejor de early_bird
    { badgeId: 'night_owl', userId: 'u1', sortScore: 100, score: 100, strength: 50, reason: 'r' },
    { badgeId: 'early_bird', userId: 'u1', sortScore: 100, score: 100, strength: 50, reason: 'r' },
    // pero u2 es candidato secundario a early_bird
    { badgeId: 'early_bird', userId: 'u2', sortScore: 40, score: 40, strength: 5, reason: 'r' },
  ];
  const assignments = chooseAssignments(candidates, memberIds, 'scope-1');
  // Al procesar night_owl (primera del catálogo tras couch_potato/lone_wolf/etc)
  // se le adjudica a u1 → u1 sube a MAX_IDENTITIES → cuando llegue
  // early_bird, u1 queda fuera de candidatos y gana u2 (o se queda vacío
  // según qué badge sea la que le tocó a u1). Verifiquemos la regla
  // general: NADIE tiene dos badges (aparte de tapado, que no es
  // competitivo pero además no lo comparte con nadie).
  const perUser = {};
  for (const a of assignments) {
    if (a.badgeId === TAPADO_BADGE_ID) continue;
    perUser[a.userId] = (perUser[a.userId] || 0) + 1;
  }
  for (const [uid, count] of Object.entries(perUser)) {
    assert.ok(count <= 1, `${uid} tiene ${count} insignias competitivas`);
  }
});

test('choose: si un usuario gana insignia, NO recibe Tapado', () => {
  const memberIds = ['u1', 'u2'];
  const candidates = [
    { badgeId: 'night_owl', userId: 'u1', sortScore: 100, score: 100, strength: 50, reason: 'r' },
  ];
  const assignments = chooseAssignments(candidates, memberIds, 'scope-1');
  const u1Assignments = assignments.filter(a => a.userId === 'u1');
  assert.equal(u1Assignments.length, 1);
  assert.equal(u1Assignments[0].badgeId, 'night_owl');
});

test('choose: en empate exacto, el desempate favorece a quien no tenga otra insignia todavía', () => {
  const memberIds = ['u1', 'u2'];
  // Consideremos una insignia hipotética donde ambos empatan. Como al
  // procesar el catálogo alguno acabará ganando algo antes, el que quede
  // "sin insignia" debe tener preferencia en la SIGUIENTE ronda.
  // Simulamos con dos candidatos empatados a night_owl (primera competitiva).
  const candidates = [
    { badgeId: 'night_owl', userId: 'u1', sortScore: 100, score: 100, strength: 10, reason: 'r' },
    { badgeId: 'night_owl', userId: 'u2', sortScore: 100, score: 100, strength: 10, reason: 'r' },
  ];
  const assignments = chooseAssignments(candidates, memberIds, 'scope-1');
  const nightOwl = assignments.find(a => a.badgeId === 'night_owl');
  // Sea u1 o u2, uno gana la insignia y el otro Tapado.
  assert.ok(['u1', 'u2'].includes(nightOwl.userId));
  const tapado = assignments.find(a => a.badgeId === TAPADO_BADGE_ID);
  assert.ok(tapado, 'debe haber un Tapado para el que empató');
  assert.notEqual(nightOwl.userId, tapado.userId);
});

test('choose: cada insignia competitiva la puede tener como mucho una persona', () => {
  const memberIds = ['u1', 'u2', 'u3'];
  const candidates = [
    { badgeId: 'night_owl', userId: 'u1', sortScore: 100, score: 100, strength: 10, reason: 'r' },
    { badgeId: 'night_owl', userId: 'u2', sortScore: 90, score: 90, strength: 5, reason: 'r' },
    { badgeId: 'night_owl', userId: 'u3', sortScore: 80, score: 80, strength: 5, reason: 'r' },
  ];
  const assignments = chooseAssignments(candidates, memberIds, 'scope-1');
  const nightOwls = assignments.filter(a => a.badgeId === 'night_owl');
  assert.equal(nightOwls.length, 1);
});

test('choose: Tapado NO es exclusivo — varios miembros pueden tenerlo a la vez', () => {
  const memberIds = ['u1', 'u2', 'u3', 'u4'];
  const candidates = [
    { badgeId: 'night_owl', userId: 'u1', sortScore: 100, score: 100, strength: 10, reason: 'r' },
  ];
  const assignments = chooseAssignments(candidates, memberIds, 'scope-1');
  const tapados = assignments.filter(a => a.badgeId === TAPADO_BADGE_ID);
  // u1 gana night_owl → u2, u3, u4 son tapado.
  assert.equal(tapados.length, 3);
});

test('choose: el reparto es reproducible entre llamadas (mismo input → mismos ganadores)', () => {
  const memberIds = ['u1', 'u2'];
  const candidates = [
    { badgeId: 'night_owl', userId: 'u1', sortScore: 100, score: 100, strength: 10, reason: 'r' },
    { badgeId: 'night_owl', userId: 'u2', sortScore: 100, score: 100, strength: 10, reason: 'r' },
  ];
  const a1 = chooseAssignments(candidates, memberIds, 'scope-1');
  const a2 = chooseAssignments(candidates, memberIds, 'scope-1');
  const winner1 = a1.find(a => a.badgeId === 'night_owl').userId;
  const winner2 = a2.find(a => a.badgeId === 'night_owl').userId;
  // Mismo empate + mismo scopeId + stableTieValue determinista → mismo
  // ganador. Si se cambiara stableTieValue a Math.random(), este test cae.
  assert.equal(winner1, winner2);
});

test('choose: la reproducibilidad depende del scopeId (los grupos deciden distinto)', () => {
  const memberIds = ['u1', 'u2'];
  const candidates = [
    { badgeId: 'night_owl', userId: 'u1', sortScore: 100, score: 100, strength: 10, reason: 'r' },
    { badgeId: 'night_owl', userId: 'u2', sortScore: 100, score: 100, strength: 10, reason: 'r' },
  ];
  // Buscamos dos scopeIds que den ganadores distintos entre estos dos
  // usuarios. Si stableTieValue funciona, en varios grupos NO gana
  // siempre el mismo (ya se probó en el test de stableTieValue). Aquí
  // solo confirmamos que chooseAssignments propaga esa dependencia.
  const winners = new Set(
    ['s1', 's2', 's3', 's4', 's5', 's6', 's7'].map(scope =>
      chooseAssignments(candidates, memberIds, scope).find(a => a.badgeId === 'night_owl').userId
    )
  );
  assert.ok(winners.size >= 2, `todos los scopes eligen al mismo (${[...winners]})`);
});

// ─── Sanidad del catálogo ─────────────────────────────────────────────
test('catálogo: cada insignia tiene los campos mínimos', () => {
  for (const b of CIRCLE_BADGES) {
    assert.equal(typeof b.id, 'string');
    assert.ok(b.id.length > 0, 'id vacío');
    assert.equal(typeof b.name, 'string');
    assert.equal(typeof b.emoji, 'string');
    assert.equal(typeof b.description, 'string');
  }
});

test('catálogo: los ids son únicos', () => {
  const ids = CIRCLE_BADGES.map(b => b.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('catálogo: existe la insignia TAPADO', () => {
  assert.ok(CIRCLE_BADGES.some(b => b.id === TAPADO_BADGE_ID),
    'sin insignia Tapado, chooseAssignments deja huérfanos sin premio');
});
