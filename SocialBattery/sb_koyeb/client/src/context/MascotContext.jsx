import { createContext, useContext, useState } from 'react';

// ── Catálogo de ACTIVIDADES ────────────────────────────────────────────────────
// Cada actividad es una capa de PRIMER PLANO que se superpone sobre la mascota base.
// Ya NO tienen tier: se pueden aplicar a cualquier nivel de batería.
// layers: array de srcs que se apilan en orden (de abajo a arriba)
// previewOffset: ajuste visual para la previsualización en la tienda (opcional)

export const MASCOT_ACTIVITIES = [
  // ── Sin actividad (por defecto) ───────────────────────────────────────────
  {
    id: 'none',
    name: 'Sin actividad',
    desc: 'Solo la mascota, sin accesorios de actividad.',
    emoji: '✨',
    layers: [],      // sin capa de actividad
    price: 0,
    isBase: true,
  },

  // ── Actividades comprables ─────────────────────────────────────────────────
  {
    id: 'act_chess',
    name: 'Ajedrez',
    desc: 'Una partida de ajedrez para ejercitar la mente.',
    emoji: '♟️',
    layers: ['/activity-chess.png'],
    price: 80,
    isBase: false,
  },
  {
    id: 'act_football',
    name: 'Fútbol',
    desc: 'A darle al balón con los amigos.',
    emoji: '⚽',
    layers: ['/activity-football.png'],
    price: 60,
    isBase: false,
  },
  {
    id: 'act_sleep',
    name: 'Siesta',
    desc: 'Recargando pilas con una siesta reparadora.',
    emoji: '💤',
    layers: ['/activity-sleep.png'],
    price: 40,
    isBase: false,
  },
  {
    id: 'act_gaming',
    name: 'Gaming',
    desc: 'Mando + auriculares: modo gamer activado.',
    emoji: '🎮',
    layers: ['/activity-gamepad.png', '/activity-headphones.png'],
    price: 120,
    isBase: false,
  },
  {
    id: 'act_reading',
    name: 'Manual de energía',
    desc: 'Aprendiendo a gestionar la batería social.',
    emoji: '📖',
    layers: ['/activity-book.png'],
    price: 70,
    isBase: false,
  },
  {
    id: 'act_cocktail',
    name: 'Cóctel',
    desc: 'Relax total con una bebida tropical.',
    emoji: '🍹',
    layers: ['/activity-cocktail.png'],
    price: 50,
    isBase: false,
  },
  {
    id: 'act_study',
    name: 'Estudiar',
    desc: 'Libros abiertos, lápiz en mano.',
    emoji: '📚',
    layers: ['/activity-study.png'],
    price: 55,
    isBase: false,
  },
];

// ── Mascota base por tier (capa de atrás) ─────────────────────────────────────
// El tier sigue controlando QUÉ imagen base se muestra, pero la actividad
// encima es independiente del tier.
export const MASCOT_BASE = {
  high: '/mascot-high.png',
  mid:  '/mascot-mid.png',
  low:  '/mascot-low.png',
};

// ── Estado por defecto ────────────────────────────────────────────────────────
const DEFAULT_UNLOCKED = new Set(
  MASCOT_ACTIVITIES.filter(a => a.isBase).map(a => a.id)
);
const DEFAULT_ACTIVE_ACTIVITY = 'none';  // actividad activa (única, global)

// ── Context ───────────────────────────────────────────────────────────────────
const MascotContext = createContext(null);

export function MascotProvider({ children }) {
  const [unlocked, setUnlocked]             = useState(DEFAULT_UNLOCKED);
  const [activeActivity, setActiveActivity] = useState(DEFAULT_ACTIVE_ACTIVITY);

  function unlockActivity(id) {
    setUnlocked(prev => new Set([...prev, id]));
  }

  function equipActivity(id) {
    setActiveActivity(id);
  }

  /**
   * Devuelve las capas para renderizar la mascota completa dado un tier.
   * Retorna: { base: string, layers: string[] }
   *  - base:   imagen de fondo (mascota según batería)
   *  - layers: imágenes de actividad que se superponen (puede ser [])
   */
  function getMascotLayers(tier) {
    const base = MASCOT_BASE[tier] ?? MASCOT_BASE.mid;
    const act  = MASCOT_ACTIVITIES.find(a => a.id === activeActivity);
    return {
      base,
      layers: act?.layers ?? [],
    };
  }

  // Compatibilidad hacia atrás: getActiveSrc devuelve solo la base
  // (los sitios que la usen seguirán funcionando mientras se migran)
  function getActiveSrc(tier) {
    return MASCOT_BASE[tier] ?? MASCOT_BASE.mid;
  }

  return (
    <MascotContext.Provider value={{
      unlocked,
      activeActivity,
      unlockActivity,
      equipActivity,
      getMascotLayers,
      getActiveSrc,
    }}>
      {children}
    </MascotContext.Provider>
  );
}

export function useMascot() {
  const ctx = useContext(MascotContext);
  if (!ctx) throw new Error('useMascot must be used inside MascotProvider');
  return ctx;
}
