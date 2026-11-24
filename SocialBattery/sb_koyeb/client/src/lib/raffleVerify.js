// Comprobación de un sorteo en el propio dispositivo: repite el cálculo de
// server/lib/raffleDraw.js (mismo algoritmo) con los datos públicos.

const encoder = new TextEncoder();
const toHex = (buffer) => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

/** Clave anónima de un participante en un sorteo. */
export const entryKey = (raffleId, userId) => sha256Hex(`${raffleId}:${userId}`);

async function drawNumber(hmacKey, label, total) {
  const signature = await crypto.subtle.sign('HMAC', hmacKey, encoder.encode(label));
  return Number(BigInt(`0x${toHex(signature)}`) % BigInt(total));
}

/** Claves ganadoras, en orden de premio. */
export async function pickWinners({ seed, raffleId, entries, count }) {
  const hmacKey = await crypto.subtle.importKey(
    'raw', encoder.encode(seed), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const pool = [...entries].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const winners = [];
  for (let i = 0; i < count && pool.length; i += 1) {
    const total = pool.reduce((sum, e) => sum + e.tickets, 0);
    let n = await drawNumber(hmacKey, `${raffleId}:${i}`, total);
    const index = pool.findIndex(e => { n -= e.tickets; return n < 0; });
    winners.push(pool[index].key);
    pool.splice(index, 1);
  }
  return winners;
}

/**
 * @param raffle sorteo serializado, ya celebrado
 * @param data   respuesta de GET /raffles/:id/verification
 * @returns {{ seedOk: boolean, participants: number, prizes: Array<{ id, title, winner, matches }> }}
 */
export async function verifyRaffle(raffle, data) {
  const seedOk = Boolean(data.seed) && await sha256Hex(data.seed) === data.commit;
  const goalReached = raffle.prizes.some(p => p.requires_goal && p.winner);
  const drawn = raffle.prizes.filter(p => goalReached || !p.requires_goal);
  const winners = await pickWinners({
    seed: data.seed, raffleId: raffle.id, entries: data.entries, count: drawn.length,
  });
  const prizes = [];
  for (let i = 0; i < drawn.length; i += 1) {
    const { id, title, winner } = drawn[i];
    const key = winner ? await entryKey(raffle.id, winner.id) : null;
    prizes.push({ id, title, winner, matches: key === (winners[i] ?? null) });
  }
  return { seedOk, participants: data.entries.length, prizes };
}
