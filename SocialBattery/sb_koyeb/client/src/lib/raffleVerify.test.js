import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { entryKey, pickWinners, verifyRaffle } from './raffleVerify.js';

const sha = (text) => createHash('sha256').update(text).digest('hex');

// Implementación de referencia: la del servidor (server/lib/raffleDraw.js).
function serverPick({ seed, raffleId, entries, count }) {
  const pool = [...entries].sort((a, b) => (a.key < b.key ? -1 : 1));
  const winners = [];
  for (let i = 0; i < count && pool.length; i += 1) {
    const total = pool.reduce((sum, e) => sum + e.tickets, 0);
    const hex = createHmac('sha256', seed).update(`${raffleId}:${i}`).digest('hex');
    let n = Number(BigInt(`0x${hex}`) % BigInt(total));
    const index = pool.findIndex(e => { n -= e.tickets; return n < 0; });
    winners.push(pool[index].key);
    pool.splice(index, 1);
  }
  return winners;
}

const users = Array.from({ length: 12 }, (_, i) => `user-${i}`);
const entriesOf = async (raffleId) => Promise.all(users.map(async (u, i) => ({ key: await entryKey(raffleId, u), tickets: i % 3 === 0 ? 3 : 1 })));

test('pickWinners da lo mismo que el servidor', async () => {
  const entries = await entriesOf('r1');
  for (const seed of ['a', 'b', sha('c')]) {
    const args = { seed, raffleId: 'r1', entries, count: 4 };
    assert.deepEqual(await pickWinners(args), serverPick(args));
  }
});

test('verifyRaffle confirma un sorteo correcto y detecta uno manipulado', async () => {
  const seed = sha('semilla');
  const entries = await entriesOf('r1');
  const [first, second] = serverPick({ seed, raffleId: 'r1', entries, count: 2 });
  const idOf = async (key) => (await Promise.all(users.map(async u => [await entryKey('r1', u), u]))).find(([k]) => k === key)[1];
  const raffle = {
    id: 'r1',
    prizes: [
      { id: 'p1', title: 'A', winner: { id: await idOf(first) } },
      { id: 'p2', title: 'B', winner: { id: await idOf(second) } },
      { id: 'p3', title: 'C', requires_goal: true, winner: null },
    ],
  };
  const data = { seed, commit: sha(seed), entries };
  const ok = await verifyRaffle(raffle, data);
  assert.equal(ok.seedOk, true);
  assert.deepEqual(ok.prizes.map(p => p.matches), [true, true]);

  raffle.prizes[0].winner = { id: 'amigo-del-organizador' };
  assert.equal((await verifyRaffle(raffle, data)).prizes[0].matches, false);
  assert.equal((await verifyRaffle(raffle, { ...data, commit: sha('otra') })).seedOk, false);
});
