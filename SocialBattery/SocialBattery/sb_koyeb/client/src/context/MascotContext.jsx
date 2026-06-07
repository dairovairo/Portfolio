import { createContext, useContext, useState } from 'react';

// ── Sistema de capas ──────────────────────────────────────────────────────────
// Capa 1 (atrás):  mascota base  → src imagen base según tier de batería
// Capa 2 (medio):  atuendo       → imagen de outfit (actualmente fusionada en la base)
// Capa 3 (delante): actividad    → imagen de actividad superpuesta encima

// ── Catálogo de ACTIVIDADES (capa delantera) ──────────────────────────────────
// Sin restricciones de tier: todas se pueden aplicar a cualquier nivel de batería.
export const MASCOT_ACTIVITIES = [
  // ── BASE: sin actividad (por defecto, gratis) ─────────────────────────────
  {
    id: 'none',
    name: 'Sin actividad',
    desc: 'Tu mascota descansando, sin nada en manos.',
    src: null,           // null = no se renderiza capa de actividad
    activitySrc: null,
    price: 0,
    isBase: true,
    emoji: '😌',
  },

  // ── ACTIVIDADES DE PAGO ───────────────────────────────────────────────────
  {
    id: 'act_gaming',
    name: 'Gaming total',
    desc: 'Mando y cascos: modo gamer activado.',
    src: null,                          // no hay mascota completa pre-fusionada
    activitySrc: '/activity-gamepad.png',  // capa delantera principal
    price: 80,
    isBase: false,
    emoji: '🎮',
    // actividad con dos elementos: gamepad (capa frontal) + headphones (overlay extra)
    activitySrc2: '/activity-headphones.png',
  },
  {
    id: 'act_chess',
    name: 'Ajedrez',
    desc: 'Un duelo de estrategia sobre el tablero.',
    src: null,
    activitySrc: '/activity-chess.png',
    price: 60,
    isBase: false,
    emoji: '♟️',
  },
  {
    id: 'act_football',
    name: 'Fútbol',
    desc: 'Siempre listo para un partido.',
    src: null,
    activitySrc: '/activity-football.png',
    price: 50,
    isBase: false,
    emoji: '⚽',
  },
  {
    id: 'act_cocktail',
    name: 'Cóctel',
    desc: 'Relajándose con una bebida tropical.',
    src: null,
    activitySrc: '/activity-cocktail.png',
    price: 55,
    isBase: false,
    emoji: '🍹',
  },
  {
    id: 'act_study',
    name: 'Estudiando',
    desc: 'Concentrada frente a los libros.',
    src: null,
    activitySrc: '/activity-study.png',
    price: 45,
    isBase: false,
    emoji: '📚',
  },
  {
    id: 'act_book',
    name: 'Manual de Energía',
    desc: 'Leyendo el manual definitivo de la batería social.',
    src: null,
    activitySrc: '/activity-book.png',
    price: 70,
    isBase: false,
    emoji: '📖',
  },
  {
    id: 'act_sleep',
    name: 'Durmiendo',
    desc: 'Zzz... recargando energías.',
    src: null,
    activitySrc: '/activity-zzz.png',
    price: 35,
    isBase: false,
    emoji: '💤',
  },
];

// ── Mascotas base por tier (capa trasera) ─────────────────────────────────────
// Estas son las imágenes del cuerpo de la mascota según el nivel de batería.
// Se usan también como "skins" comprables en la tienda (separados de las actividades).
export const MASCOT_BASE_SKINS = [
  // HIGH (67-100%)
  { id: 'high_1', tier: 'high', name: 'Energía base',    src: '/mascot-high.png',   price: 0,   isBase: true  },
  { id: 'high_3', tier: 'high', name: 'Aventura total',  src: '/mascot-high-3.png', price: 100, isBase: false },
  { id: 'high_5', tier: 'high', name: 'Euforia máxima',  src: '/mascot-high-5.png', price: 150, isBase: false },
  // MID (34-66%)
  { id: 'mid_1',  tier: 'mid',  name: 'Calma base',      src: '/mascot-mid.png',    price: 0,   isBase: true  },
  { id: 'mid_4',  tier: 'mid',  name: 'Tarde tranquila', src: '/mascot-mid-4.png',  price: 60,  isBase: false },
  { id: 'mid_5',  tier: 'mid',  name: 'Equilibrio zen',  src: '/mascot-mid-5.png',  price: 80,  isBase: false },
  // LOW (0-33%)
  { id: 'low_1',  tier: 'low',  name: 'Recarga base',    src: '/mascot-low.png',    price: 0,   isBase: true  },
  { id: 'low_3',  tier: 'low',  name: 'Siesta sagrada',  src: '/mascot-low-3.png',  price: 50,  isBase: false },
  { id: 'low_4',  tier: 'low',  name: 'Batería crítica', src: '/mascot-low-4.png',  price: 60,  isBase: false },
];

// IDs desbloqueados por defecto
const DEFAULT_UNLOCKED = new Set([
  ...MASCOT_BASE_SKINS.filter(s => s.isBase).map(s => s.id),
  'none', // actividad "sin actividad" siempre desbloqueada
]);

// Estado activo por defecto
const DEFAULT_ACTIVE_SKINS = { high: 'high_1', mid: 'mid_1', low: 'low_1' };
const DEFAULT_ACTIVE_ACTIVITY = 'none'; // actividad global única

// ── Context ───────────────────────────────────────────────────────────────────
const MascotContext = createContext(null);

export function MascotProvider({ children }) {
  const [unlocked, setUnlocked]           = useState(DEFAULT_UNLOCKED);
  const [activeSkins, setActiveSkins]     = useState(DEFAULT_ACTIVE_SKINS);
  const [activeActivity, setActiveActivityState] = useState(DEFAULT_ACTIVE_ACTIVITY);

  function unlockActivity(id) {
    setUnlocked(prev => new Set([...prev, id]));
  }

  function setActiveSkin(tier, id) {
    setActiveSkins(prev => ({ ...prev, [tier]: id }));
  }

  function setActiveActivity(id) {
    setActiveActivityState(id);
  }

  /** Devuelve la src de la mascota base (capa trasera) para un tier dado */
  function getBaseSrc(tier) {
    const id = activeSkins[tier];
    return MASCOT_BASE_SKINS.find(s => s.id === id)?.src
      ?? MASCOT_BASE_SKINS.find(s => s.tier === tier && s.isBase)?.src;
  }

  /** Devuelve la actividad activa (capa delantera) */
  function getActiveActivityData() {
    return MASCOT_ACTIVITIES.find(a => a.id === activeActivity) ?? MASCOT_ACTIVITIES[0];
  }

  // Legacy: getActiveSrc devuelve la misma que getBaseSrc (compatibilidad con código existente)
  function getActiveSrc(tier) {
    return getBaseSrc(tier);
  }

  return (
    <MascotContext.Provider value={{
      unlocked,
      activeSkins,
      activeActivity,
      unlockActivity,
      setActiveSkin,
      setActiveActivity,
      getBaseSrc,
      getActiveSrc,       // legacy alias
      getActiveActivityData,
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
