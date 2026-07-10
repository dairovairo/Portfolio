// ─────────────────────────────────────────────────────────────────────────
// Moneda del juego: Volts ⚡ — usada en la tienda de la mascota (ShopPage).
// El saldo se persiste en localStorage por usuario (no hay tabla en Supabase
// para esto todavía), igual que el resto del sistema de tienda.
// ─────────────────────────────────────────────────────────────────────────

export const CURRENCY_SYMBOL = '⚡';
export const CURRENCY_NAME = 'Volt';
export const CURRENCY_NAME_PLURAL = 'Volts';

// Recompensa diaria por pulsar "Actualizar batería" (una vez al día).
export const DAILY_BATTERY_REWARD = 10;

// Saldo inicial de un usuario nuevo (antes de comprar nada). A partir de
// aquí, el saldo se persiste en localStorage por usuario — ver
// VOLTS_STORAGE_KEY — para que no se regenere cada vez que se entra a la
// tienda o se reabre la app.
const STARTING_VOLTS = 340;

// Se mantiene el nombre de clave original ('sb-shop-coins') para no perder
// el saldo ya guardado de usuarios existentes al renombrar la moneda.
const VOLTS_STORAGE_KEY = 'sb-shop-coins';
const DAILY_REWARD_STORAGE_KEY = 'sb-daily-volts-claim';

export function loadVolts(userId) {
  if (!userId) return STARTING_VOLTS;
  try {
    const raw = localStorage.getItem(`${VOLTS_STORAGE_KEY}_${userId}`);
    if (raw === null) return STARTING_VOLTS;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : STARTING_VOLTS;
  } catch {
    return STARTING_VOLTS;
  }
}

export function saveVolts(userId, value) {
  if (!userId) return;
  try {
    localStorage.setItem(`${VOLTS_STORAGE_KEY}_${userId}`, String(value));
  } catch {}
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ¿Ya se reclamó hoy la recompensa diaria por actualizar la batería?
export function hasClaimedDailyBatteryReward(userId) {
  if (!userId) return false;
  try {
    return localStorage.getItem(`${DAILY_REWARD_STORAGE_KEY}_${userId}`) === todayKey();
  } catch {
    return false;
  }
}

// Intenta reclamar los Volts diarios por actualizar la batería. Solo se
// puede reclamar una vez al día por usuario. Devuelve { claimed, volts }
// donde `volts` es el saldo resultante (se haya reclamado o no).
export function claimDailyBatteryReward(userId) {
  if (!userId || hasClaimedDailyBatteryReward(userId)) {
    return { claimed: false, volts: loadVolts(userId) };
  }
  const volts = loadVolts(userId) + DAILY_BATTERY_REWARD;
  saveVolts(userId, volts);
  try {
    localStorage.setItem(`${DAILY_REWARD_STORAGE_KEY}_${userId}`, todayKey());
  } catch {}
  return { claimed: true, volts };
}
