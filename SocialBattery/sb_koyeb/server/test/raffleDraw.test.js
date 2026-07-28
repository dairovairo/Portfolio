// Tests unitarios de server/lib/raffleDraw.js — ejecución del sorteo
// (adjudicar premios a ganadores). Correr con:
//
//   node --test server/test/raffleDraw.test.js
//
// Como purgeUserStorage.test.js, este mockea el cliente Supabase por
// require.cache antes de cargar el módulo. La adjudicación no es puramente
// pura (usa Math.random), pero controlamos ese punto reemplazando Math.random
// por una función determinista durante los tests. Con eso, verificamos:
//
//   - Sorteo legacy (sin premios en tabla): un único ganador aleatorio va
//     a community_raffles.winner_id.
//   - Sorteo con premios (fase 122): Fisher-Yates parcial + adjudicación
//     por posición.
//   - Sin elegibles: se cierra el sorteo (drawn_at seteado) sin ganadores.
//   - Más premios que elegibles: sobran premios sin winner_id.
//
// Y de paso: verificamos que notifyRaffleDrawn nunca lanza aunque el
// notifyUsers inyectado falle — un fallo del push no debe revertir el
// sorteo.

const test = require('node:test');
const assert = require('node:assert/strict');

// ─── Mock de Supabase ─────────────────────────────────────────────────
// Este mock captura las llamadas encadenadas del estilo:
//   supabase.from('t').select('*').eq('col', v).order('c').maybeSingle()
// y devuelve datos preparados por test. Cada test setea `state.tables` para
// simular los datos.

const state = {
  tables: {},          // { tableName: [row, ...] }
  updates: [],         // registro de UPDATEs para verificar
  errorOnUpdate: null, // 'tableName' → fuerza error en su update
};

function reset() {
  state.tables = {};
  state.updates = [];
  state.errorOnUpdate = null;
}

// Chainable "query" que colecciona el estado y ejecuta al final.
function makeQuery(tableName) {
  const q = {
    _op: 'select',
    _filters: [],
    _order: null,
    _select: '*',
    _updateData: null,
    select(cols) { this._op = this._op === 'update' ? 'update-select' : 'select'; this._select = cols; return this; },
    update(data) { this._op = 'update'; this._updateData = data; return this; },
    delete() { this._op = 'delete'; return this; },
    eq(col, val) { this._filters.push({ col, val }); return this; },
    order(col) { this._order = col; return this; },
    // Terminales: single, maybeSingle, o then implícito.
    async single() {
      const rows = this._exec();
      return { data: rows[0] ?? null, error: rows.length ? null : { message: 'not found' } };
    },
    async maybeSingle() {
      const rows = this._exec();
      return { data: rows[0] ?? null, error: null };
    },
    then(resolve, reject) {
      try {
        const rows = this._exec();
        resolve({ data: rows, error: null });
      } catch (e) { reject(e); }
    },
    _exec() {
      const t = state.tables[tableName] || [];
      let rows = t.filter(row =>
        this._filters.every(f => row[f.col] === f.val)
      );
      if (this._op === 'update') {
        if (state.errorOnUpdate === tableName) throw new Error('update failed');
        for (const row of rows) Object.assign(row, this._updateData);
        state.updates.push({ table: tableName, data: this._updateData, filters: this._filters });
      }
      if (this._order) rows = rows.slice().sort((a, b) => a[this._order] - b[this._order]);
      return rows;
    },
  };
  return q;
}

const mockSupabase = {
  from(table) { return makeQuery(table); },
};

// Inyecta el mock en require.cache antes de cargar raffleDraw.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://stub.local';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'stub-key';
const supabasePath = require.resolve('../lib/supabase');
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true, exports: mockSupabase,
};
const { drawRaffleWinners, notifyRaffleDrawn } = require('../lib/raffleDraw');

// Aleatoriedad controlada durante los tests — devuelve valores predecibles.
const originalRandom = Math.random;
let randomSeed = 0;
function setRandom(values) {
  randomSeed = 0;
  Math.random = () => values[(randomSeed++) % values.length];
}
const restoreRandom = () => { Math.random = originalRandom; };

const originalWarn = console.warn;
test.beforeEach(() => { reset(); console.warn = () => {}; });
test.afterEach(() => { restoreRandom(); console.warn = originalWarn; });

// ─── Tests: drawRaffleWinners — camino legacy (sin premios) ───────────

test('legacy: 5 elegibles → elige uno con Math.random y setea winner_id + drawn_at', async () => {
  state.tables['community_raffle_prizes'] = []; // sin premios
  state.tables['community_raffles'] = [{ id: 'r1', winner_id: null, drawn_at: null }];
  setRandom([0.5]); // 0.5 * 5 = 2.5 → índice 2

  const result = await drawRaffleWinners({ raffleId: 'r1', eligibleIds: ['a', 'b', 'c', 'd', 'e'] });
  assert.equal(result.prizesDrawn, 1);
  assert.equal(result.totalPrizes, 0);
  const raffle = state.tables['community_raffles'][0];
  assert.equal(raffle.winner_id, 'c'); // índice 2
  assert.ok(raffle.drawn_at, 'drawn_at debe estar seteado');
});

test('legacy: sin elegibles → drawn_at seteado, winner_id sigue null, prizesDrawn=0', async () => {
  state.tables['community_raffle_prizes'] = [];
  state.tables['community_raffles'] = [{ id: 'r1', winner_id: null, drawn_at: null }];

  const result = await drawRaffleWinners({ raffleId: 'r1', eligibleIds: [] });
  assert.equal(result.prizesDrawn, 0);
  const raffle = state.tables['community_raffles'][0];
  assert.equal(raffle.winner_id, null);
  assert.ok(raffle.drawn_at);
});

// ─── Tests: drawRaffleWinners — camino con premios (fase 122) ─────────

test('premios: 3 premios y 5 elegibles → 3 ganadores adjudicados por posición', async () => {
  state.tables['community_raffle_prizes'] = [
    { raffle_id: 'r1', id: 'p1', position: 1, winner_id: null },
    { raffle_id: 'r1', id: 'p2', position: 2, winner_id: null },
    { raffle_id: 'r1', id: 'p3', position: 3, winner_id: null },
  ];
  state.tables['community_raffles'] = [{ id: 'r1', drawn_at: null }];
  // Fisher-Yates parcial: 3 pasadas, cada una elige un índice de los
  // que quedan por barajar. Con valores 0, 0, 0 → siempre elige el
  // primero del "resto sin barajar", que va rotando.
  setRandom([0, 0, 0]);

  const result = await drawRaffleWinners({ raffleId: 'r1', eligibleIds: ['a', 'b', 'c', 'd', 'e'] });
  assert.equal(result.prizesDrawn, 3);
  assert.equal(result.totalPrizes, 3);
  // Los tres primeros premios tienen winner_id asignado; el sorteo cerrado.
  const prizes = state.tables['community_raffle_prizes'];
  assert.ok(prizes.every(p => p.winner_id !== null));
  assert.ok(state.tables['community_raffles'][0].drawn_at);
});

test('premios: sin elegibles → prizesDrawn=0 pero drawn_at igualmente seteado', async () => {
  state.tables['community_raffle_prizes'] = [
    { raffle_id: 'r1', id: 'p1', position: 1, winner_id: null },
  ];
  state.tables['community_raffles'] = [{ id: 'r1', drawn_at: null }];

  const result = await drawRaffleWinners({ raffleId: 'r1', eligibleIds: [] });
  assert.equal(result.prizesDrawn, 0);
  assert.equal(result.totalPrizes, 1);
  // El premio queda sin winner_id — permitido por schema.
  assert.equal(state.tables['community_raffle_prizes'][0].winner_id, null);
  // Pero el sorteo queda cerrado igual (idempotencia).
  assert.ok(state.tables['community_raffles'][0].drawn_at);
});

test('premios: más premios que elegibles → solo se adjudican tantos como elegibles', async () => {
  state.tables['community_raffle_prizes'] = [
    { raffle_id: 'r1', id: 'p1', position: 1, winner_id: null },
    { raffle_id: 'r1', id: 'p2', position: 2, winner_id: null },
    { raffle_id: 'r1', id: 'p3', position: 3, winner_id: null },
  ];
  state.tables['community_raffles'] = [{ id: 'r1', drawn_at: null }];
  setRandom([0, 0]);

  const result = await drawRaffleWinners({ raffleId: 'r1', eligibleIds: ['a', 'b'] });
  assert.equal(result.prizesDrawn, 2);
  assert.equal(result.totalPrizes, 3);
  // El tercer premio queda sin adjudicar (winner_id null).
  const p3 = state.tables['community_raffle_prizes'].find(p => p.position === 3);
  assert.equal(p3.winner_id, null);
});

test('premios: no adjudica el mismo elegible dos veces (sin reemplazo)', async () => {
  state.tables['community_raffle_prizes'] = [
    { raffle_id: 'r1', id: 'p1', position: 1, winner_id: null },
    { raffle_id: 'r1', id: 'p2', position: 2, winner_id: null },
    { raffle_id: 'r1', id: 'p3', position: 3, winner_id: null },
  ];
  state.tables['community_raffles'] = [{ id: 'r1', drawn_at: null }];
  setRandom([0.1, 0.2, 0.3]);

  await drawRaffleWinners({ raffleId: 'r1', eligibleIds: ['a', 'b', 'c'] });
  const winners = state.tables['community_raffle_prizes'].map(p => p.winner_id);
  assert.equal(new Set(winners).size, winners.length,
    `hay duplicados en ganadores: ${winners.join(', ')}`);
});

test('premios: el orden de posición se respeta — el i-ésimo extraído va al premio i-ésimo', async () => {
  state.tables['community_raffle_prizes'] = [
    { raffle_id: 'r1', id: 'pA', position: 2, winner_id: null }, // orden desordenado a propósito
    { raffle_id: 'r1', id: 'pB', position: 1, winner_id: null },
  ];
  state.tables['community_raffles'] = [{ id: 'r1', drawn_at: null }];
  setRandom([0, 0]);

  await drawRaffleWinners({ raffleId: 'r1', eligibleIds: ['ganador1', 'ganador2'] });
  // El código pide prizes ordenados por position ascending, y adjudica
  // el i-ésimo extraído al i-ésimo por position. Position 1 gana primero.
  const p1 = state.tables['community_raffle_prizes'].find(p => p.position === 1);
  const p2 = state.tables['community_raffle_prizes'].find(p => p.position === 2);
  assert.equal(p1.winner_id, 'ganador1', 'position 1 recibe el primer extraído');
  assert.equal(p2.winner_id, 'ganador2', 'position 2 recibe el segundo extraído');
});

// ─── Tests: notifyRaffleDrawn — no debe lanzar nunca ──────────────────

test('notify: si notifyUsers lanza, el error se traga (no revierte el sorteo)', async () => {
  state.tables['community_raffles'] = [{ id: 'r1', title: 'X', community_id: 'c1', community: { name: 'Comunidad' } }];
  const notifyUsersThatFails = async () => { throw new Error('push broken'); };
  await assert.doesNotReject(
    notifyRaffleDrawn(mockSupabase, notifyUsersThatFails, {
      raffleId: 'r1', eligibleIds: ['a'], creatorId: 'creator',
    })
  );
});

test('notify: sin elegibles → sale sin llamar a notifyUsers', async () => {
  let calls = 0;
  const notifyUsers = async () => { calls++; };
  await notifyRaffleDrawn(mockSupabase, notifyUsers, {
    raffleId: 'r1', eligibleIds: [], creatorId: 'creator',
  });
  assert.equal(calls, 0);
});

test('notify: si el sorteo no existe → sale sin llamar a notifyUsers', async () => {
  state.tables['community_raffles'] = []; // ninguno
  let calls = 0;
  const notifyUsers = async () => { calls++; };
  await notifyRaffleDrawn(mockSupabase, notifyUsers, {
    raffleId: 'no-existe', eligibleIds: ['a'], creatorId: 'creator',
  });
  assert.equal(calls, 0);
});

test('notify: pasa creatorId como "sender" y usa el nombre de la comunidad', async () => {
  state.tables['community_raffles'] = [{
    id: 'r1', title: 'Sorteo X', community_id: 'c1',
    community: { name: 'Mi Comu' },
  }];
  let capturedArgs = null;
  const notifyUsers = async (supabase, ids, sender, payload) => {
    capturedArgs = { ids, sender, payload };
  };
  await notifyRaffleDrawn(mockSupabase, notifyUsers, {
    raffleId: 'r1', eligibleIds: ['u1', 'u2'], creatorId: 'creator',
  });
  assert.deepEqual(capturedArgs.ids, ['u1', 'u2']);
  assert.equal(capturedArgs.sender, 'creator');
  assert.ok(capturedArgs.payload.body.includes('Sorteo X'));
  assert.ok(capturedArgs.payload.body.includes('Mi Comu'));
  assert.equal(capturedArgs.payload.tag, 'raffle-drawn-r1');
});
