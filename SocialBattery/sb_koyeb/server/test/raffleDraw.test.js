// Tests del sorteo: elección de ganadores (pura) y drawRaffle con un Supabase
// simulado. Correr con: node --test server/test/raffleDraw.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// ─── Mocks (antes de cargar el módulo) ────────────────────────────────
const db = {};
const failOn = new Set();

function query(table) {
  let op = 'select';
  let patch = null;
  const filters = [];
  const run = () => {
    if (failOn.has(`${op}:${table}`)) return { data: null, error: new Error('fallo forzado') };
    const rows = db[table].filter(r => filters.every(f => f(r)));
    if (op === 'update') rows.forEach(r => Object.assign(r, patch));
    if (op === 'upsert') db[table].push({ ...patch });
    return { data: rows.map(r => ({ ...r })), error: null };
  };
  const b = {
    select: () => b,
    update: (p) => { op = 'update'; patch = p; return b; },
    upsert: (p) => { op = 'upsert'; patch = p; return b; },
    eq: (c, v) => { filters.push(r => r[c] === v); return b; },
    is: (c, v) => { filters.push(r => (r[c] ?? null) === v); return b; },
    order: () => b,
    maybeSingle: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
    then: (a, c) => Promise.resolve(run()).then(a, c),
  };
  return b;
}

function mock(path, exports) {
  const id = require.resolve(path);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

let participants = [];
let raised = 0;
mock('../lib/supabase', { from: query });
mock('../lib/raffles', {
  getRaffleParticipants: async () => participants,
  getRaisedCents: async () => raised,
});

const { createDrawSecret, entryKey, pickWinners, drawRaffle, redrawPrize, getVerification } = require('../lib/raffleDraw');

function reset({ prizes = [], goal = null, people = [], raisedCents = 0 } = {}) {
  const secret = createDrawSecret();
  participants = people.map(p => (typeof p === 'string' ? { userId: p, tickets: 1 } : p));
  raised = raisedCents;
  failOn.clear();
  db.community_raffles = [{ id: 'r1', community_id: 'c1', creator_id: 'boss', title: 'S', drawn_at: null, goal_cents: goal, draw_commit: secret.commit, winner_id: null }];
  db.raffle_draw_secrets = [{ raffle_id: 'r1', seed: secret.seed }];
  db.community_raffle_prizes = prizes.map((p, i) => ({
    id: `p${i + 1}`, raffle_id: 'r1', position: i + 1, requires_goal: false, winner_id: null, previous_winners: [], ...p,
  }));
  return secret;
}

// ─── pickWinners ──────────────────────────────────────────────────────
test('createDrawSecret: el compromiso publicado es el sha256 de la semilla', () => {
  const { seed, commit } = createDrawSecret();
  assert.equal(commit, crypto.createHash('sha256').update(seed).digest('hex'));
});

test('pickWinners: mismos datos, mismo resultado, sin depender del orden', () => {
  const entries = Array.from({ length: 20 }, (_, i) => ({ key: `k${i}`, tickets: 1 }));
  const a = pickWinners({ seed: 'ab', raffleId: 'r', entries, count: 5 });
  const b = pickWinners({ seed: 'ab', raffleId: 'r', entries: [...entries].reverse(), count: 5 });
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, 5);
});

test('pickWinners: nunca más ganadores que participantes', () => {
  assert.equal(pickWinners({ seed: 'x', raffleId: 'r', entries: [{ key: 'a', tickets: 3 }], count: 4 }).length, 1);
  assert.deepEqual(pickWinners({ seed: 'x', raffleId: 'r', entries: [], count: 2 }), []);
});

test('pickWinners: 3 papeletas ganan unas 3 veces más', () => {
  const entries = [{ key: 'a', tickets: 3 }, { key: 'b', tickets: 1 }];
  let a = 0;
  for (let i = 0; i < 4000; i += 1) {
    if (pickWinners({ seed: `s${i}`, raffleId: 'r', entries, count: 1 })[0] === 'a') a += 1;
  }
  assert.ok(a > 2850 && a < 3150, `esperado ~3000, salió ${a}`);
});

// ─── drawRaffle ───────────────────────────────────────────────────────
test('drawRaffle: adjudica premios distintos, revela la semilla y abre el plazo', async () => {
  const secret = reset({ prizes: [{}, {}], people: ['a', 'b', 'c'] });
  const result = await drawRaffle('r1');
  assert.equal(result.winners.length, 2);
  const [p1, p2] = db.community_raffle_prizes;
  assert.notEqual(p1.winner_id, p2.winner_id);
  assert.equal(p1.claim_status, 'pending');
  assert.ok(new Date(p1.claim_deadline) > new Date());
  const raffle = db.community_raffles[0];
  assert.equal(raffle.draw_seed, secret.seed);
  assert.equal(raffle.draw_entries, 3);
});

test('drawRaffle: el resultado se puede comprobar con los datos públicos', async () => {
  reset({ prizes: [{}, {}], people: ['a', 'b', 'c', 'd'] });
  await drawRaffle('r1');
  const winners = pickWinners({
    seed: db.community_raffles[0].draw_seed, raffleId: 'r1',
    entries: await getVerification('r1'), count: 2,
  });
  assert.deepEqual(winners, db.community_raffle_prizes.map(p => entryKey('r1', p.winner_id)));
});

test('drawRaffle: la segunda vez no hace nada', async () => {
  reset({ prizes: [{}], people: ['a'] });
  assert.ok(await drawRaffle('r1'));
  assert.equal(await drawRaffle('r1'), null);
});

test('drawRaffle: sin participantes se cierra sin ganadores', async () => {
  reset({ prizes: [{}] });
  const result = await drawRaffle('r1');
  assert.deepEqual(result.winners, []);
  assert.ok(db.community_raffles[0].drawn_at);
  assert.equal(db.community_raffle_prizes[0].winner_id, null);
});

test('drawRaffle: los premios extra solo se sortean si se alcanza la meta', async () => {
  const prizes = [{}, { requires_goal: true }];
  reset({ prizes, goal: 1000, people: ['a', 'b', 'c'], raisedCents: 999 });
  assert.equal((await drawRaffle('r1')).goalReached, false);
  assert.ok(db.community_raffle_prizes[0].winner_id);
  assert.equal(db.community_raffle_prizes[1].winner_id, null);

  reset({ prizes, goal: 1000, people: ['a', 'b', 'c'], raisedCents: 1000 });
  assert.equal((await drawRaffle('r1')).goalReached, true);
  assert.ok(db.community_raffle_prizes[1].winner_id);
});

test('drawRaffle: si algo falla se deshace para poder reintentarlo', async () => {
  reset({ prizes: [{}], people: ['a', 'b'] });
  failOn.add('update:raffle_draw_secrets');
  await assert.rejects(drawRaffle('r1'));
  assert.equal(db.community_raffles[0].drawn_at, null);
  failOn.clear();
  assert.ok(await drawRaffle('r1'));
});

test('drawRaffle: sorteo antiguo sin premios → ganador único', async () => {
  reset({ people: ['a', 'b'] });
  await drawRaffle('r1');
  assert.ok(['a', 'b'].includes(db.community_raffles[0].winner_id));
});

// ─── redrawPrize ──────────────────────────────────────────────────────
test('redrawPrize: elige a otra persona que no haya ganado ya', async () => {
  reset({ prizes: [{}, {}], people: ['a', 'b', 'c'] });
  await drawRaffle('r1');
  const [p1, p2] = db.community_raffle_prizes.map(p => ({ ...p }));
  const result = await redrawPrize(p2);
  assert.ok(result.winnerId);
  assert.ok(![p1.winner_id, p2.winner_id].includes(result.winnerId));
  assert.deepEqual(db.community_raffle_prizes[1].previous_winners, [p2.winner_id]);
});

test('redrawPrize: sin más participantes el premio queda desierto', async () => {
  reset({ prizes: [{}], people: ['a'] });
  await drawRaffle('r1');
  const result = await redrawPrize({ ...db.community_raffle_prizes[0] });
  assert.equal(result.winnerId, null);
  assert.equal(db.community_raffle_prizes[0].claim_status, null);
});
