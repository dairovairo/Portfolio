import { createContext, useContext, useState } from 'react';

// ── Catálogo de ACCESORIOS (capa intermedia) ──────────────────────────────────
export const MASCOT_ACCESSORIES = [
  {
    id: 'acc_none',
    name: 'Sin accesorio',
    desc: 'Solo la mascota base.',
    emoji: '✨',
    src: null,
    price: 0,
    isBase: true,
  },
  {
    id: 'acc_glasses',
    name: 'Gafas de sol',
    desc: 'Look icónico con montura negra.',
    emoji: '😎',
    src: '/accessory-glasses.png',
    price: 60,
    isBase: false,
  },
  {
    id: 'acc_chain',
    name: 'Cadena de oro',
    desc: 'Bling-bling para los más flexeros.',
    emoji: '⛓️',
    src: '/accessory-chain.png',
    price: 90,
    isBase: false,
  },
  {
    id: 'acc_grillz',
    name: 'Grillz diamante',
    desc: 'Sonrisa millonaria con diamantes.',
    emoji: '💎',
    src: '/accessory-grillz.png',
    price: 150,
    isBase: false,
  },
  {
    id: 'acc_sneakers_converse',
    name: 'Converse gradient',
    desc: 'Zapatillas retro con degradado energético.',
    emoji: '👟',
    src: '/accessory-sneakers-converse.png',
    price: 70,
    isBase: false,
  },
  {
    id: 'acc_sneakers_jordan',
    name: 'Jordan SB Energy',
    desc: 'Las zapatillas de edición especial SocialBattery.',
    emoji: '🔥',
    src: '/accessory-sneakers-jordan.png',
    price: 120,
    isBase: false,
  },
  {
    id: 'acc_cap',
    name: 'Gorra negra',
    desc: 'Estilo urbano para cualquier plan.',
    emoji: '🧢',
    src: '/accessory-cap.png',
    price: 45,
    isBase: false,
  },
];

// ── Catálogo de ACTIVIDADES (capa delantera) ──────────────────────────────────
export const MASCOT_ACTIVITIES = [
  {
    id: 'none',
    name: 'Sin actividad',
    desc: 'Solo la mascota, sin elemento de actividad.',
    emoji: '⚡',
    layers: [],
    price: 0,
    isBase: true,
  },
  {
    id: 'act_chess',
    name: 'Ajedrez',
    desc: 'Una partida para ejercitar la mente.',
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
    desc: 'Mando en mano: modo gamer activado.',
    emoji: '🎮',
    layers: ['/activity-gamepad.png'],
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
  {
    id: 'act_gym',
    name: 'Gimnasio',
    desc: 'A levantar hierro y recargar endorfinas.',
    emoji: '🏋️',
    layers: ['/activity-gym.png'],
    price: 75,
    isBase: false,
  },
  {
    id: 'act_piano',
    name: 'Piano',
    desc: 'Notas que fluyen y llenan la batería.',
    emoji: '🎹',
    layers: ['/activity-piano.png'],
    price: 90,
    isBase: false,
  },
];

// ── Mascota base por tier (capa de atrás) ─────────────────────────────────────
export const MASCOT_BASE = {
  high: '/mascot-high.png',
  mid:  '/mascot-mid.png',
  low:  '/mascot-low.png',
};

// ── Estado por defecto ────────────────────────────────────────────────────────
const DEFAULT_UNLOCKED_ACTIVITIES  = new Set(MASCOT_ACTIVITIES.filter(a => a.isBase).map(a => a.id));
const DEFAULT_UNLOCKED_ACCESSORIES = new Set(MASCOT_ACCESSORIES.filter(a => a.isBase).map(a => a.id));

// ── Context ───────────────────────────────────────────────────────────────────
const MascotContext = createContext(null);

export function MascotProvider({ children }) {
  const [unlockedActivities,  setUnlockedActivities]  = useState(DEFAULT_UNLOCKED_ACTIVITIES);
  const [unlockedAccessories, setUnlockedAccessories] = useState(DEFAULT_UNLOCKED_ACCESSORIES);
  const [activeActivity,  setActiveActivity]  = useState('none');
  const [activeAccessory, setActiveAccessory] = useState('acc_none');

  // Actividades
  function unlockActivity(id) {
    setUnlockedActivities(prev => new Set([...prev, id]));
  }
  function equipActivity(id) {
    setActiveActivity(id);
  }

  // Accesorios
  function unlockAccessory(id) {
    setUnlockedAccessories(prev => new Set([...prev, id]));
  }
  function equipAccessory(id) {
    setActiveAccessory(id);
  }

  /**
   * Devuelve las 3 capas para renderizar la mascota completa dado un tier:
   *   base       → src imagen mascota según batería
   *   accessory  → src accesorio activo (null si ninguno)
   *   layers     → array de srcs de actividad
   */
  function getMascotLayers(tier) {
    const base = MASCOT_BASE[tier] ?? MASCOT_BASE.mid;
    const acc  = MASCOT_ACCESSORIES.find(a => a.id === activeAccessory);
    const act  = MASCOT_ACTIVITIES.find(a => a.id === activeActivity);
    return {
      base,
      accessory: acc?.src ?? null,
      layers: act?.layers ?? [],
    };
  }

  // Compatibilidad hacia atrás
  function getActiveSrc(tier) {
    return MASCOT_BASE[tier] ?? MASCOT_BASE.mid;
  }

  // unlocked combinado (para retrocompat con ShopPage)
  const unlocked = new Set([...unlockedActivities, ...unlockedAccessories]);

  return (
    <MascotContext.Provider value={{
      unlocked,
      unlockedActivities,
      unlockedAccessories,
      activeActivity,
      activeAccessory,
      unlockActivity,
      unlockAccessory,
      equipActivity,
      equipAccessory,
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
