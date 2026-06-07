import { createContext, useContext, useState } from 'react';

// ── Catálogo canónico de mascotas ─────────────────────────────────────────────
// Cada entrada es un "skin" de actividad comprable en la tienda.
// Las primeras de cada tier (isBase: true) están desbloqueadas por defecto.

export const MASCOT_ACTIVITIES = [
  // ── HIGH (batería 67-100%) ────────────────────────────────────────────────
  {
    id: 'high_1',
    tier: 'high',
    name: 'Energía base',
    desc: 'Tu mascota rebosante de energía, lista para todo.',
    src: '/mascot-high.png',
    price: 0,
    isBase: true,
  },
  {
    id: 'high_3',
    tier: 'high',
    name: 'Aventura total',
    desc: 'Exploradora nata, lista para cualquier plan.',
    src: '/mascot-high-3.png',
    price: 100,
    isBase: false,
  },
  {
    id: 'high_4',
    tier: 'high',
    name: 'Poder social',
    desc: 'Radiante y conectada con todo el mundo.',
    src: '/mascot-high-4.png',
    price: 120,
    isBase: false,
  },
  {
    id: 'high_5',
    tier: 'high',
    name: 'Euforia máxima',
    desc: 'El pico de energía social. Imparable.',
    src: '/mascot-high-5.png',
    price: 150,
    isBase: false,
  },

  // ── MID (batería 34-66%) ──────────────────────────────────────────────────
  {
    id: 'mid_1',
    tier: 'mid',
    name: 'Calma base',
    desc: 'Tu mascota en su estado de equilibrio.',
    src: '/mascot-mid.png',
    price: 0,
    isBase: true,
  },
  {
    id: 'mid_4',
    tier: 'mid',
    name: 'Tarde tranquila',
    desc: 'Relajada pero con ganas de socializar un poco.',
    src: '/mascot-mid-4.png',
    price: 60,
    isBase: false,
  },
  {
    id: 'mid_5',
    tier: 'mid',
    name: 'Equilibrio zen',
    desc: 'En paz con el mundo y con energía moderada.',
    src: '/mascot-mid-5.png',
    price: 80,
    isBase: false,
  },

  // ── LOW (batería 0-33%) ───────────────────────────────────────────────────
  {
    id: 'low_1',
    tier: 'low',
    name: 'Recarga base',
    desc: 'Tu mascota necesita un buen descanso.',
    src: '/mascot-low.png',
    price: 0,
    isBase: true,
  },
  {
    id: 'low_3',
    tier: 'low',
    name: 'Siesta sagrada',
    desc: 'Recuperando energías para mañana.',
    src: '/mascot-low-3.png',
    price: 50,
    isBase: false,
  },
  {
    id: 'low_4',
    tier: 'low',
    name: 'Batería crítica',
    desc: 'Al límite, pero sobreviviendo.',
    src: '/mascot-low-4.png',
    price: 60,
    isBase: false,
  },
];

// IDs base desbloqueados por defecto
const DEFAULT_UNLOCKED = new Set(
  MASCOT_ACTIVITIES.filter(a => a.isBase).map(a => a.id)
);
// Skin activo por tier por defecto
const DEFAULT_ACTIVE = {
  high: 'high_1',
  mid:  'mid_1',
  low:  'low_1',
};

// ── Context ───────────────────────────────────────────────────────────────────
const MascotContext = createContext(null);

export function MascotProvider({ children }) {
  // Set de IDs desbloqueados (comprados o base)
  const [unlocked, setUnlocked] = useState(DEFAULT_UNLOCKED);
  // ID activo por tier
  const [activeSkins, setActiveSkins] = useState(DEFAULT_ACTIVE);

  function unlockActivity(id) {
    setUnlocked(prev => new Set([...prev, id]));
  }

  function setActiveSkin(tier, id) {
    setActiveSkins(prev => ({ ...prev, [tier]: id }));
  }

  /** Devuelve la src de imagen activa para un tier dado */
  function getActiveSrc(tier) {
    const id = activeSkins[tier];
    return MASCOT_ACTIVITIES.find(a => a.id === id)?.src
      ?? MASCOT_ACTIVITIES.find(a => a.tier === tier && a.isBase)?.src;
  }

  return (
    <MascotContext.Provider value={{ unlocked, activeSkins, unlockActivity, setActiveSkin, getActiveSrc }}>
      {children}
    </MascotContext.Provider>
  );
}

export function useMascot() {
  const ctx = useContext(MascotContext);
  if (!ctx) throw new Error('useMascot must be used inside MascotProvider');
  return ctx;
}
