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
    id: 'acc_chain',
    name: 'Cadena de oro',
    desc: 'Bling-bling para los más flexeros.',
    emoji: '⛓️',
    src: '/accessory-chain.png',
    price: 90,
    isBase: false,
    isChain: true,
  },
  {
    id: 'acc_chain_silver',
    name: 'Cadena de plata',
    desc: 'Estilo elegante con plata maciza.',
    emoji: '🔗',
    src: '/accessory-chain-silver.png',
    price: 75,
    isBase: false,
    isChain: true,
  },
  {
    id: 'acc_chain_black',
    name: 'Cadena negra',
    desc: 'Oscura y misteriosa, para el lado rebelde.',
    emoji: '🖤',
    src: '/accessory-chain-black.png',
    price: 80,
    isBase: false,
    isChain: true,
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
    id: 'acc_grillz_gold',
    name: 'Grillz de oro',
    desc: 'Dientes de oro para la sonrisa más flexera.',
    emoji: '🥇',
    src: '/accessory-grillz-gold.png',
    price: 120,
    isBase: false,
  },
  {
    id: 'acc_sneakers_converse',
    name: 'Zapatillas retro gradient',
    desc: 'Zapatillas retro con degradado energético.',
    emoji: '👟',
    src: '/accessory-sneakers-converse.png',
    price: 70,
    isBase: false,
  },
  {
    id: 'acc_sneakers_jordan',
    name: 'Zapatillas SB Energy',
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

// ── Catálogo de OUTFIT ────────────────────────────────────────────────────────

// Cabeza
export const MASCOT_OUTFIT_HEAD = [
  {
    id: 'head_none',
    name: 'Sin prenda',
    desc: 'Sin nada en la cabeza.',
    emoji: '✨',
    src: null,
    price: 0,
    isBase: true,
  },
  {
    id: 'head_glasses',
    name: 'Gafas de sol',
    desc: 'Look icónico con montura negra.',
    emoji: '😎',
    src: '/accessory-glasses.png',
    price: 60,
    isBase: false,
  },
];

// Accesorios de outfit (joyería, etc.)
export const MASCOT_OUTFIT_ACCESSORIES = [
  {
    id: 'outfitacc_none',
    name: 'Sin accesorio',
    desc: 'Sin accesorios de outfit.',
    emoji: '✨',
    src: null,
    price: 0,
    isBase: true,
  },
];

// Camisas
export const MASCOT_OUTFIT_SHIRTS = [
  {
    id: 'shirt_none',
    name: 'Sin camisa',
    desc: 'Sin camisa, el estilo natural.',
    emoji: '✨',
    src: null,
    price: 0,
    isBase: true,
  },
  {
    id: 'shirt_tropical',
    name: 'Camisa tropical',
    desc: 'Flores de hibisco, vibraciones de verano.',
    emoji: '🌺',
    src: '/outfit-shirt-tropical.png',
    price: 80,
    isBase: false,
  },
  {
    id: 'shirt_white',
    name: 'Camisa blanca',
    desc: 'Clásica y limpia, para cualquier plan.',
    emoji: '🤍',
    src: '/outfit-shirt-white.png',
    price: 60,
    isBase: false,
  },
  {
    id: 'shirt_boho',
    name: 'Camisa boho',
    desc: 'Diseño abstracto con ondas y hojas.',
    emoji: '🌿',
    src: '/outfit-shirt-boho.png',
    price: 90,
    isBase: false,
  },
  {
    id: 'shirt_flames',
    name: 'Camisa llamas',
    desc: 'Negro con llamas rosas, energía oscura.',
    emoji: '🔥',
    src: '/outfit-shirt-flames.png',
    price: 110,
    isBase: false,
  },
  {
    id: 'shirt_navy',
    name: 'Camisa azul marino',
    desc: 'Lisa, azul marino, clean y directa.',
    emoji: '🔵',
    src: '/outfit-shirt-navy.png',
    price: 55,
    isBase: false,
  },
  {
    id: 'shirt_tropical_dark',
    name: 'Camisa tropical oscura',
    desc: 'Flores de hibisco crema sobre azul profundo.',
    emoji: '🌸',
    src: '/outfit-shirt-tropical-dark.png',
    price: 95,
    isBase: false,
  },
  {
    id: 'shirt_black',
    name: 'Camisa negra',
    desc: 'Lisa y oscura, el clásico infalible.',
    emoji: '🖤',
    src: '/outfit-shirt-black.png',
    price: 50,
    isBase: false,
  },
  {
    id: 'shirt_sunset',
    name: 'Camisa sunset',
    desc: 'Atardecer tropical con palmeras y flores.',
    emoji: '🌅',
    src: '/outfit-shirt-sunset.png',
    price: 100,
    isBase: false,
  },
  {
    id: 'tshirt_white',
    name: 'Camiseta blanca',
    desc: 'Básica y limpia, lo más versátil del armario.',
    emoji: '🤍',
    src: '/outfit-tshirt-white.png',
    price: 40,
    isBase: false,
  },
  {
    id: 'tshirt_cyber',
    name: 'Camiseta cyber',
    desc: 'Circuitos neón sobre negro. SYS_001 activado.',
    emoji: '🤖',
    src: '/outfit-tshirt-cyber.png',
    price: 130,
    isBase: false,
  },
  {
    id: 'tshirt_futbol',
    name: 'Camiseta fútbol',
    desc: 'Franjas clásicas blanco y negro. Futura FC.',
    emoji: '⚽',
    src: '/outfit-tshirt-futbol.png',
    price: 85,
    isBase: false,
  },
  {
    id: 'tshirt_desert',
    name: 'Camiseta Desert Oasis',
    desc: 'Diseño vintage de desierto con cactus y sol.',
    emoji: '🌵',
    src: '/outfit-tshirt-desert.png',
    price: 75,
    isBase: false,
  },
  {
    id: 'tshirt_floral',
    name: 'Camiseta floral',
    desc: 'Trazos botánicos en acuarela verde y salmón.',
    emoji: '🌿',
    src: '/outfit-tshirt-floral.png',
    price: 70,
    isBase: false,
  },
  {
    id: 'tshirt_neon',
    name: 'Camiseta neon X',
    desc: 'Gráfico abstracto neón violeta y cian.',
    emoji: '⚡',
    src: '/outfit-tshirt-neon.png',
    price: 110,
    isBase: false,
  },
  {
    id: 'tshirt_ocean',
    name: 'Camiseta ocean',
    desc: 'Ondas suaves y conchas marinas en azul.',
    emoji: '🐚',
    src: '/outfit-tshirt-ocean.png',
    price: 80,
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
    name: 'Leyendo',
    desc: 'Un buen libro para recargar la mente.',
    emoji: '📖',
    layers: ['/activity-book.png'],
    price: 70,
    isBase: false,
  },
  {
    id: 'act_cocktail',
    name: 'De fiesta',
    desc: 'Modo fiesta activado, a disfrutar.',
    emoji: '🎉',
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
const DEFAULT_UNLOCKED_HEAD        = new Set(MASCOT_OUTFIT_HEAD.filter(a => a.isBase).map(a => a.id));
const DEFAULT_UNLOCKED_OUTFITACCS  = new Set(MASCOT_OUTFIT_ACCESSORIES.filter(a => a.isBase).map(a => a.id));
const DEFAULT_UNLOCKED_SHIRTS      = new Set(MASCOT_OUTFIT_SHIRTS.filter(a => a.isBase).map(a => a.id));

// ── Context ───────────────────────────────────────────────────────────────────
const MascotContext = createContext(null);

export function MascotProvider({ children }) {
  const [unlockedActivities,  setUnlockedActivities]  = useState(DEFAULT_UNLOCKED_ACTIVITIES);
  const [unlockedAccessories, setUnlockedAccessories] = useState(DEFAULT_UNLOCKED_ACCESSORIES);
  const [unlockedHead,        setUnlockedHead]        = useState(DEFAULT_UNLOCKED_HEAD);
  const [unlockedOutfitAccs,  setUnlockedOutfitAccs]  = useState(DEFAULT_UNLOCKED_OUTFITACCS);
  const [unlockedShirts,      setUnlockedShirts]      = useState(DEFAULT_UNLOCKED_SHIRTS);

  const [activeActivity,  setActiveActivity]  = useState('none');
  const [activeAccessory, setActiveAccessory] = useState('acc_none');
  const [activeHead,      setActiveHead]      = useState('head_none');
  const [activeOutfitAcc, setActiveOutfitAcc] = useState('outfitacc_none');
  const [activeShirt,     setActiveShirt]     = useState('shirt_none');

  // Actividades
  function unlockActivity(id) { setUnlockedActivities(prev => new Set([...prev, id])); }
  function equipActivity(id)  { setActiveActivity(id); }

  // Accesorios
  function unlockAccessory(id) { setUnlockedAccessories(prev => new Set([...prev, id])); }
  function equipAccessory(id)  { setActiveAccessory(id); }

  // Outfit - cabeza
  function unlockHead(id) { setUnlockedHead(prev => new Set([...prev, id])); }
  function equipHead(id)  { setActiveHead(id); }

  // Outfit - accesorios
  function unlockOutfitAcc(id) { setUnlockedOutfitAccs(prev => new Set([...prev, id])); }
  function equipOutfitAcc(id)  { setActiveOutfitAcc(id); }

  // Outfit - camisas
  function unlockShirt(id) { setUnlockedShirts(prev => new Set([...prev, id])); }
  function equipShirt(id)  { setActiveShirt(id); }

  /**
   * Devuelve las capas para renderizar la mascota completa dado un tier.
   */
  function getMascotLayers(tier) {
    const base = MASCOT_BASE[tier] ?? MASCOT_BASE.mid;
    const acc  = MASCOT_ACCESSORIES.find(a => a.id === activeAccessory);
    const act  = MASCOT_ACTIVITIES.find(a => a.id === activeActivity);
    return {
      base,
      accessory: acc?.src ?? null,
      accessoryIsChain: acc?.isChain ?? false,
      layers: act?.layers ?? [],
    };
  }

  // Compatibilidad hacia atrás
  function getActiveSrc(tier) {
    return MASCOT_BASE[tier] ?? MASCOT_BASE.mid;
  }

  const unlocked = new Set([...unlockedActivities, ...unlockedAccessories, ...unlockedHead, ...unlockedOutfitAccs, ...unlockedShirts]);

  return (
    <MascotContext.Provider value={{
      unlocked,
      unlockedActivities,
      unlockedAccessories,
      unlockedHead,
      unlockedOutfitAccs,
      unlockedShirts,
      activeActivity,
      activeAccessory,
      activeHead,
      activeOutfitAcc,
      activeShirt,
      unlockActivity,
      unlockAccessory,
      unlockHead,
      unlockOutfitAcc,
      unlockShirt,
      equipActivity,
      equipAccessory,
      equipHead,
      equipOutfitAcc,
      equipShirt,
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
