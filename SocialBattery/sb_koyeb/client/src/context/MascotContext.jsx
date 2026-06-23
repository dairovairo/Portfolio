import { createContext, useContext, useState } from 'react';

// ── Personalización extrema de color (pies) ───────────────────────────────────
// A diferencia de antes, personalizar el color de una zapatilla YA NO
// modifica el modelo original: en vez de guardar la receta de zonas bajo el
// id del ítem del catálogo, cada personalización crea un ÍTEM NUEVO e
// independiente (con su propio id `feet_custom_<n>`), que vive únicamente en
// el apartado "Calzado personalizado". El ítem original (`baseId`) permanece
// intacto en su carrusel/sub-tab, sin recolorear, en cualquier otro sitio
// donde se muestre.
//
// Forma de cada entrada guardada (objeto completo, no solo la receta):
//   {
//     id: 'feet_custom_1719999999999',
//     baseId: 'feet_sneaker_1',       // ítem original del que partió
//     name: 'Zapatillas retro gris piedra (personalizada)',
//     emoji: '👟',
//     desc: 'Personalización de "Zapatillas retro gris piedra".',
//     src: '/outfit-feet-1.png',      // src ORIGINAL (se recolorea al vuelo
//                                     // con useColorizedSrc, igual que antes)
//     zones: [{ x, y, tolerance, color }, …],
//     price: 0,
//     offsetX/offsetY/scale: copiados del ítem base, para que se posicione
//                              igual que él.
//   }
//
// Se guarda en localStorage (como las preferencias de SettingsContext) para
// que una personalización no se pierda al recargar la app, aunque el resto
// del estado de la mascota (equipado/desbloqueado) por ahora viva solo en
// memoria.
const FEET_CUSTOMIZATIONS_STORAGE_KEY = 'sb-feet-color-zones';
const HEAD_CUSTOMIZATIONS_STORAGE_KEY = 'sb-head-color-zones';
const OUTFIT_CUSTOMIZATIONS_STORAGE_KEY = 'sb-outfit-color-zones';
const ACCESSORY_CUSTOMIZATIONS_STORAGE_KEY = 'sb-accessory-color-zones';
const SAVED_OUTFITS_STORAGE_KEY = 'sb-saved-outfits';

function loadFeetCustomizations() {
  try {
    const raw = localStorage.getItem(FEET_CUSTOMIZATIONS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    // Migración silenciosa desde el formato antiguo (donde la clave era el
    // id del modelo ORIGINAL y el valor era directamente el array de zonas:
    // { [feetItemId]: [{x,y,tolerance,color}, …] }). Si detectamos ese
    // formato, lo descartamos: ya no tiene sentido aplicarlo (recoloreaba el
    // modelo original), así el usuario simplemente vuelve a personalizar
    // desde cero con el nuevo sistema de ítems independientes.
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const values = Object.values(parsed);
      const looksLegacy = values.length > 0 && Array.isArray(values[0]);
      if (looksLegacy) return {};
    }
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function loadHeadCustomizations() {
  try {
    const raw    = localStorage.getItem(HEAD_CUSTOMIZATIONS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function loadStoredCustomizations(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function loadSavedOutfits() {
  try {
    const raw = localStorage.getItem(SAVED_OUTFITS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

// ── Catálogo de OUTFITS / TORSO (capa 3: encima de pies, debajo de cabeza) ─────
export const MASCOT_OUTFITS = [
  // El ítem base "Sin prenda" se duplica aquí: una entrada por subcategoría
  // (camiseta / camisa), ambas con el MISMO id 'out_none'. Visualmente solo
  // se ve una u otra a la vez (cada una aparece solo en su propia sub-tab,
  // vía `filteredOutfits` en ShopPage.jsx), pero las dos representan
  // exactamente lo mismo: el torso vacío. Al equipar cualquiera de las dos,
  // se quita la camiseta Y la camisa a la vez (solo puede haber un outfit
  // de torso activo, sea de la subcategoría que sea), por eso comparten id.
  {
    id: 'out_none',
    name: 'Sin prenda',
    desc: 'La mascota sin camiseta en el torso.',
    emoji: '✨',
    src: null,
    subcategory: 'camiseta',
    price: 0,
    isBase: true,
  },
  {
    id: 'out_none',
    name: 'Sin prenda',
    desc: 'La mascota sin camisa en el torso.',
    emoji: '✨',
    src: null,
    subcategory: 'camisa',
    price: 0,
    isBase: true,
  },
  // ── Camisetas ────────────────────────────────────────────────────────────────
  // Todas las camisetas llevan un `scale: 0.985` propio (1.5%, dentro del
  // rango 1-2% pedido) que se multiplica sobre el scale general de la
  // subcategoría (ver OUTFIT_VISUAL_ADJUST.camiseta más abajo), EXCEPTO
  // "Camiseta del abuelo" (out_tshirt_21), que se queda con su tamaño actual.
  {
    id: 'out_tshirt_1',
    name: 'Camiseta negra',
    desc: 'Básica y siempre elegante.',
    emoji: '🖤',
    src: '/outfit-tshirt-1.png',
    subcategory: 'camiseta',
    isBasic: true,
    price: 50,
    isBase: false,
    scale: 0.985,
  },
  {
    id: 'out_tshirt_2',
    name: 'Camiseta blanca',
    desc: 'Minimalismo puro y versátil.',
    emoji: '🤍',
    src: '/outfit-tshirt-2.png',
    subcategory: 'camiseta',
    isBasic: true,
    price: 50,
    isBase: false,
    scale: 0.985,
  },
  {
    id: 'out_tshirt_3',
    name: 'Camiseta amarilla',
    desc: 'Un toque de color vibrante para destacar.',
    emoji: '💛',
    src: '/outfit-tshirt-3.png',
    subcategory: 'camiseta',
    isBasic: true,
    price: 55,
    isBase: false,
    scale: 0.985,
  },
  {
    id: 'out_tshirt_4',
    name: 'Camiseta rosa',
    desc: 'Divertida y luminosa, pura energía SB.',
    emoji: '🩷',
    src: '/outfit-tshirt-4.png',
    subcategory: 'camiseta',
    isBasic: true,
    price: 70,
    isBase: false,
    scale: 0.985,
  },
  {
    id: 'out_tshirt_5',
    name: 'Camiseta naranja',
    desc: 'Energía pura en un color bien vivo.',
    emoji: '🧡',
    src: '/outfit-tshirt-5.png',
    subcategory: 'camiseta',
    isBasic: true,
    price: 75,
    isBase: false,
    scale: 0.985,
  },
  {
    id: 'out_tshirt_6',
    name: 'Camiseta roja',
    desc: 'Para los que quieren destacar.',
    emoji: '❤️',
    src: '/outfit-tshirt-6.png',
    subcategory: 'camiseta',
    isBasic: true,
    price: 60,
    isBase: false,
    scale: 0.985,
  },
  {
    id: 'out_tshirt_7',
    name: 'Camiseta morada',
    desc: 'Vibra con la energía SB.',
    emoji: '💜',
    src: '/outfit-tshirt-7.png',
    subcategory: 'camiseta',
    isBasic: true,
    price: 65,
    isBase: false,
    scale: 0.985,
  },
  {
    id: 'out_tshirt_8',
    name: 'Camiseta azul',
    desc: 'Fresca y casual para el día a día.',
    emoji: '💙',
    src: '/outfit-tshirt-8.png',
    subcategory: 'camiseta',
    isBasic: true,
    price: 55,
    isBase: false,
    scale: 0.985,
  },
  {
    id: 'out_tshirt_9',
    name: 'Camiseta gris',
    desc: 'Sobria y versátil, combina con todo.',
    emoji: '🩶',
    src: '/outfit-tshirt-9.png',
    subcategory: 'camiseta',
    isBasic: true,
    price: 50,
    isBase: false,
    scale: 0.985,
  },
  {
    id: 'out_tshirt_10',
    name: 'Camiseta verde',
    desc: 'Un verde vivo que llama la atención.',
    emoji: '💚',
    src: '/outfit-tshirt-10.png',
    subcategory: 'camiseta',
    isBasic: true,
    price: 60,
    isBase: false,
    scale: 0.985,
  },
  {
    id: 'out_tshirt_11',
    name: 'Camiseta Wild Heart',
    desc: 'Estampado desértico con cactus y atardecer.',
    emoji: '🌵',
    src: '/outfit-tshirt-11.png',
    subcategory: 'camiseta',
    price: 85,
    isBase: false,
    scale: 0.985,
  },
  {
    id: 'out_tshirt_12',
    name: 'Camiseta kawaii',
    desc: 'Lazos, flores y estrellas sobre fondo negro.',
    emoji: '🎀',
    src: '/outfit-tshirt-12.png',
    subcategory: 'camiseta',
    price: 80,
    isBase: false,
    scale: 0.985,
  },
  {
    id: 'out_tshirt_13',
    name: 'Camiseta corazón y mariposa',
    desc: 'Estilo grunge romántico con destellos y alas.',
    emoji: '🦋',
    src: '/outfit-tshirt-13.png',
    subcategory: 'camiseta',
    price: 80,
    isBase: false,
    scale: 0.985,
  },
  {
    id: 'out_tshirt_14',
    name: 'Camiseta estrella tribal',
    desc: 'Llamas tribales y una estrella en tono envejecido.',
    emoji: '⭐',
    src: '/outfit-tshirt-14.png',
    subcategory: 'camiseta',
    price: 75,
    isBase: false,
    scale: 0.985,
  },
  {
    id: 'out_tshirt_15',
    name: 'Camiseta Saltwater Soul',
    desc: 'Ancla náutica sobre azul marino, estilo retro.',
    emoji: '⚓',
    src: '/outfit-tshirt-15.png',
    subcategory: 'camiseta',
    price: 85,
    isBase: false,
    scale: 0.985,
  },
  {
    id: 'out_tshirt_16',
    name: 'Camiseta Sunset Drive',
    desc: 'Palmeras y carretera al atardecer, vibra retro.',
    emoji: '🌴',
    src: '/outfit-tshirt-16.png',
    subcategory: 'camiseta',
    price: 85,
    isBase: false,
    scale: 0.985,
  },
  {
    id: 'out_tshirt_17',
    name: 'Camiseta West Coast',
    desc: 'Olas y palmera en tonos costeros relajados.',
    emoji: '🌊',
    src: '/outfit-tshirt-17.png',
    subcategory: 'camiseta',
    price: 85,
    isBase: false,
    scale: 0.985,
  },
  {
    id: 'out_tshirt_18',
    name: 'Camiseta escudo medieval',
    desc: 'Heráldica con león, espadas y corona dorada.',
    emoji: '🛡️',
    src: '/outfit-tshirt-18.png',
    subcategory: 'camiseta',
    price: 95,
    isBase: false,
    scale: 0.985,
  },
  {
    id: 'out_tshirt_20',
    name: 'Camiseta marrón',
    desc: 'Color tierra cálido, combina con todo.',
    emoji: '🤎',
    src: '/outfit-tshirt-20.png',
    subcategory: 'camiseta',
    isBasic: true,
    price: 50,
    isBase: false,
    scale: 0.985,
  },
  {
    // Prenda de tirantes: usa por ahora el mismo scale/offset por defecto del
    // resto de camisetas en OUTFIT_VISUAL_ADJUST, con un empujoncito propio
    // hacia arriba (offsetY) para que los tirantes asienten un poco mejor
    // sobre los hombros. Subida un poco más (0% → -4% → -8% → -12%).
    id: 'out_tshirt_21',
    name: 'Camiseta del abuelo',
    desc: 'Top deportivo con costuras dobles y escote redondo.',
    emoji: '🤍',
    src: '/outfit-tshirt-21.png',
    subcategory: 'camiseta',
    price: 55,
    isBase: false,
    offsetY: '-12%',
  },
  // ── Camisas ──────────────────────────────────────────────────────────────────
  // Lote 1
  {
    id: 'out_shirt_1',
    name: 'Camisa flor de cerezo',
    desc: 'Estampado oriental en tonos crema con ramas de sakura.',
    emoji: '🌸',
    src: '/outfit-shirt-1.png',
    subcategory: 'camisa',
    price: 90,
    isBase: false,
  },
  {
    id: 'out_shirt_2',
    name: 'Camisa La Gran Ola',
    desc: 'Inspirada en el clásico grabado japonés de Hokusai.',
    emoji: '🌊',
    src: '/outfit-shirt-2.png',
    subcategory: 'camisa',
    price: 100,
    isBase: false,
  },
  {
    id: 'out_shirt_3',
    name: 'Camisa gris carbón',
    desc: 'Sobria y versátil, combina con cualquier accesorio.',
    emoji: '🩶',
    src: '/outfit-shirt-3.png',
    subcategory: 'camisa',
    isBasic: true,
    price: 70,
    isBase: false,
  },
  {
    id: 'out_shirt_4',
    name: 'Camisa amarilla mostaza',
    desc: 'Un toque de color vibrante para destacar.',
    emoji: '💛',
    src: '/outfit-shirt-4.png',
    subcategory: 'camisa',
    isBasic: true,
    price: 75,
    isBase: false,
  },
  {
    id: 'out_shirt_5',
    name: 'Camisa rosa chicle',
    desc: 'Divertida y luminosa, pura energía SB.',
    emoji: '🩷',
    src: '/outfit-shirt-5.png',
    subcategory: 'camisa',
    isBasic: true,
    price: 80,
    isBase: false,
  },
  {
    id: 'out_shirt_6',
    name: 'Camisa hibisco tropical',
    desc: 'Estampado floral nocturno con hibiscos y hojas tropicales.',
    emoji: '🌺',
    src: '/outfit-shirt-6.png',
    subcategory: 'camisa',
    price: 110,
    isBase: false,
  },
  {
    id: 'out_shirt_7',
    name: 'Camisa botánica lineal',
    desc: 'Ilustración botánica minimalista en líneas finas.',
    emoji: '🌿',
    src: '/outfit-shirt-7.png',
    subcategory: 'camisa',
    price: 85,
    isBase: false,
  },
  // Lote 2
  {
    id: 'out_shirt_8',
    name: 'Camisa blanca clásica',
    desc: 'Limpia, atemporal y combina con todo.',
    emoji: '🤍',
    src: '/outfit-shirt-8.png',
    subcategory: 'camisa',
    isBasic: true,
    price: 65,
    isBase: false,
  },
  {
    id: 'out_shirt_9',
    name: 'Camisa azul cielo',
    desc: 'Fresca y relajada, ideal para cualquier día.',
    emoji: '💙',
    src: '/outfit-shirt-9.png',
    subcategory: 'camisa',
    isBasic: true,
    price: 70,
    isBase: false,
  },
  {
    id: 'out_shirt_10',
    name: 'Camisa verde esmeralda',
    desc: 'Un verde vivo que llama la atención.',
    emoji: '💚',
    src: '/outfit-shirt-10.png',
    subcategory: 'camisa',
    isBasic: true,
    price: 70,
    isBase: false,
  },
  {
    id: 'out_shirt_11',
    name: 'Camisa morada intensa',
    desc: 'Color profundo con mucha personalidad.',
    emoji: '💜',
    src: '/outfit-shirt-11.png',
    subcategory: 'camisa',
    isBasic: true,
    price: 75,
    isBase: false,
  },
  {
    id: 'out_shirt_12',
    name: 'Camisa negra básica',
    desc: 'El clásico que nunca falla.',
    emoji: '🖤',
    src: '/outfit-shirt-12.png',
    subcategory: 'camisa',
    isBasic: true,
    price: 80,
    isBase: false,
  },
  {
    id: 'out_shirt_13',
    name: 'Camisa tormenta eléctrica',
    desc: 'Un rayo dorado cruza la tela en plena noche.',
    emoji: '⚡',
    src: '/outfit-shirt-13.png',
    subcategory: 'camisa',
    price: 105,
    isBase: false,
  },
  {
    id: 'out_shirt_14',
    name: 'Camisa Impresión, sol naciente',
    desc: 'Inspirada en el icónico amanecer impresionista de Monet.',
    emoji: '🌅',
    src: '/outfit-shirt-14.png',
    subcategory: 'camisa',
    price: 100,
    isBase: false,
  },
  {
    id: 'out_shirt_15',
    name: 'Camisa punk rebelde',
    desc: 'Calaveras, cadenas y estilo sin filtros.',
    emoji: '💀',
    src: '/outfit-shirt-15.png',
    subcategory: 'camisa',
    price: 115,
    isBase: false,
  },
  // Lote 3
  {
    id: 'out_shirt_16',
    name: 'Camisa retro arcoíris',
    desc: 'Paisajes, estrellas y un arcoíris en colores pastel.',
    emoji: '🌈',
    src: '/outfit-shirt-16.png',
    subcategory: 'camisa',
    price: 85,
    isBase: false,
  },
  {
    id: 'out_shirt_17',
    name: 'Camisa espiral beige',
    desc: 'Líneas onduladas en tonos crema y marrón.',
    emoji: '🌀',
    src: '/outfit-shirt-17.png',
    subcategory: 'camisa',
    price: 70,
    isBase: false,
  },
  {
    id: 'out_shirt_18',
    name: 'Camisa roja',
    desc: 'Un clásico atrevido en rojo intenso.',
    emoji: '❤️',
    src: '/outfit-shirt-18.png',
    subcategory: 'camisa',
    isBasic: true,
    price: 65,
    isBase: false,
  },
  {
    id: 'out_shirt_19',
    name: 'Camisa naranja',
    desc: 'Energía pura en un color bien vivo.',
    emoji: '🧡',
    src: '/outfit-shirt-19.png',
    subcategory: 'camisa',
    isBasic: true,
    price: 65,
    isBase: false,
  },
  {
    id: 'out_shirt_20',
    name: 'Camisa hibisco amarillo',
    desc: 'Estampado tropical de hibiscos sobre fondo dorado.',
    emoji: '🌼',
    src: '/outfit-shirt-20.png',
    subcategory: 'camisa',
    price: 90,
    isBase: false,
  },
  {
    id: 'out_shirt_21',
    name: 'Camisa náutica y cardos',
    desc: 'Brújulas, constelaciones y cardos en tonos dorados.',
    emoji: '🧭',
    src: '/outfit-shirt-21.png',
    subcategory: 'camisa',
    price: 95,
    isBase: false,
  },
  {
    id: 'out_shirt_22',
    name: 'Camisa marrón',
    desc: 'Tono tierra clásico, fácil de combinar.',
    emoji: '🤎',
    src: '/outfit-shirt-22.png',
    subcategory: 'camisa',
    isBasic: true,
    price: 65,
    isBase: false,
  },
];

// ── Catálogo de ACCESORIOS (capa 5: encima de cabeza) ──────────────────────────
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
  // ── Ítems "Sin X" por categoría de selección única ──────────────────────────
  // Cada grupo de selección única (gafas, cadenas, grillz, corbatas,
  // pajaritas) tiene su propia opción "Sin [categoría]" como primera
  // tarjeta del carrusel correspondiente, igual que el resto de categorías
  // de la tienda (outfit, pies, cabeza) tienen su "Sin X". Equiparla
  // desactiva cualquier accesorio ya puesto de ese mismo grupo (ver
  // `toggleAccessory`/`equipAccessory` en este mismo archivo), sin afectar
  // a los accesorios de los demás grupos.
  {
    id: 'acc_glasses_none',
    name: 'Sin gafas',
    desc: 'Sin gafas de sol puestas.',
    emoji: '✨',
    src: null,
    price: 0,
    isBase: true,
    isGlasses: true,
  },
  {
    id: 'acc_chain_none',
    name: 'Sin cadena',
    desc: 'Sin cadena puesta.',
    emoji: '✨',
    src: null,
    price: 0,
    isBase: true,
    isChain: true,
  },
  {
    id: 'acc_grillz_none',
    name: 'Sin grillz',
    desc: 'Sin grillz puestos.',
    emoji: '✨',
    src: null,
    price: 0,
    isBase: true,
    isGrillz: true,
  },
  {
    id: 'acc_tie_none',
    name: 'Sin corbata',
    desc: 'Sin corbata puesta.',
    emoji: '✨',
    src: null,
    price: 0,
    isBase: true,
    isTie: true,
  },
  {
    id: 'acc_bowtie_none',
    name: 'Sin pajarita',
    desc: 'Sin pajarita puesta.',
    emoji: '✨',
    src: null,
    price: 0,
    isBase: true,
    isBowTie: true,
  },
  {
    // Reducidas un 3% respecto al overlay a tamaño completo del lienzo (ver
    // `scale` en MascotDisplay.jsx, capa de accesorios "planos").
    id: 'acc_glasses',
    name: 'Gafas de sol',
    desc: 'Look icónico con montura negra.',
    emoji: '😎',
    src: '/accessory-glasses.png',
    price: 60,
    isBase: false,
    scale: 0.97,
    isGlasses: true,
  },
  {
    // Reducidas un 40% respecto al overlay a tamaño completo del lienzo
    // (igual que acc_glasses) — ver `scale` en MascotDisplay.jsx, capa de
    // accesorios "planos". Reducidas un 5% más (0.6 → 0.57), y otro 5% más
    // (0.57 → 0.54).
    id: 'acc_glasses_gold',
    name: 'Gafas doradas',
    desc: 'Montura dorada con cristales oscuros, máximo estilo.',
    emoji: '🕶️',
    src: '/accessory-glasses-gold.png',
    price: 70,
    isBase: false,
    scale: 0.54,
    isGlasses: true,
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
    isGrillz: true,
  },
  {
    id: 'acc_grillz_gold',
    name: 'Grillz de oro',
    desc: 'Dientes de oro para la sonrisa más flexera.',
    emoji: '🥇',
    src: '/accessory-grillz-gold.png',
    price: 120,
    isBase: false,
    isGrillz: true,
  },
  {
    id: 'acc_tie',
    name: 'Corbata azul marino',
    desc: 'Look formal con corbata clásica en azul marino.',
    emoji: '👔',
    src: '/accessory-tie.png',
    price: 65,
    isBase: false,
    isTie: true,
  },
  {
    id: 'acc_tie_red',
    name: 'Corbata roja',
    desc: 'Corbata de gala en rojo intenso.',
    emoji: '👔',
    src: '/accessory-tie-red.png',
    price: 65,
    isBase: false,
    isTie: true,
  },
  {
    id: 'acc_tie_green',
    name: 'Corbata verde',
    desc: 'Corbata clásica en verde oscuro.',
    emoji: '👔',
    src: '/accessory-tie-green.png',
    price: 65,
    isBase: false,
    isTie: true,
  },
  {
    id: 'acc_tie_gold',
    name: 'Corbata dorada',
    desc: 'Corbata lujosa en tono dorado.',
    emoji: '👔',
    src: '/accessory-tie-gold.png',
    price: 65,
    isBase: false,
    isTie: true,
  },
  {
    id: 'acc_tie_pink',
    name: 'Corbata rosa',
    desc: 'Corbata elegante en rosa palo.',
    emoji: '👔',
    src: '/accessory-tie-pink.png',
    price: 65,
    isBase: false,
    isTie: true,
  },
  {
    id: 'acc_tie_black',
    name: 'Corbata negra',
    desc: 'Corbata clásica en negro total.',
    emoji: '👔',
    src: '/accessory-tie-black.png',
    price: 65,
    isBase: false,
    isTie: true,
  },
  {
    id: 'acc_tie_gray',
    name: 'Corbata gris',
    desc: 'Corbata sobria en gris antracita.',
    emoji: '👔',
    src: '/accessory-tie-gray.png',
    price: 65,
    isBase: false,
    isTie: true,
  },
  {
    id: 'acc_tie_white',
    name: 'Corbata blanca',
    desc: 'Corbata blanca de gala, impecable.',
    emoji: '👔',
    src: '/accessory-tie-white.png',
    price: 65,
    isBase: false,
    isTie: true,
  },
  {
    id: 'acc_tie_brown',
    name: 'Corbata marrón',
    desc: 'Corbata en marrón cálido y elegante.',
    emoji: '👔',
    src: '/accessory-tie-brown.png',
    price: 65,
    isBase: false,
    isTie: true,
  },
  {
    id: 'acc_tie_purple',
    name: 'Corbata morada',
    desc: 'Corbata en morado intenso, llamativa.',
    emoji: '👔',
    src: '/accessory-tie-purple.png',
    price: 65,
    isBase: false,
    isTie: true,
  },
  {
    id: 'acc_tie_orange',
    name: 'Corbata naranja',
    desc: 'Corbata en naranja vibrante, para destacar.',
    emoji: '👔',
    src: '/accessory-tie-orange.png',
    price: 65,
    isBase: false,
    isTie: true,
  },
  {
    id: 'acc_bowtie',
    name: 'Pajarita azul marino',
    desc: 'Elegancia al máximo con pajarita de gala.',
    emoji: '🎀',
    src: '/accessory-bowtie.png',
    price: 70,
    isBase: false,
    isBowTie: true,
  },
  {
    id: 'acc_bowtie_red',
    name: 'Pajarita roja',
    desc: 'Pajarita de gala en rojo intenso.',
    emoji: '🎀',
    src: '/accessory-bowtie-red.png',
    price: 70,
    isBase: false,
    isBowTie: true,
  },
  {
    id: 'acc_bowtie_green',
    name: 'Pajarita verde',
    desc: 'Pajarita elegante en verde oscuro.',
    emoji: '🎀',
    src: '/accessory-bowtie-green.png',
    price: 70,
    isBase: false,
    isBowTie: true,
  },
  {
    id: 'acc_bowtie_gold',
    name: 'Pajarita dorada',
    desc: 'Pajarita lujosa en tono dorado.',
    emoji: '🎀',
    src: '/accessory-bowtie-gold.png',
    price: 70,
    isBase: false,
    isBowTie: true,
  },
  {
    id: 'acc_bowtie_orange',
    name: 'Pajarita naranja',
    desc: 'Pajarita vibrante en naranja cálido.',
    emoji: '🎀',
    src: '/accessory-bowtie-orange.png',
    price: 70,
    isBase: false,
    isBowTie: true,
  },
  {
    id: 'acc_bowtie_brown',
    name: 'Pajarita marrón',
    desc: 'Pajarita clásica en marrón cálido.',
    emoji: '🎀',
    src: '/accessory-bowtie-brown.png',
    price: 70,
    isBase: false,
    isBowTie: true,
  },
  {
    id: 'acc_bowtie_purple',
    name: 'Pajarita morada',
    desc: 'Pajarita llamativa en morado intenso.',
    emoji: '🎀',
    src: '/accessory-bowtie-purple.png',
    price: 70,
    isBase: false,
    isBowTie: true,
  },
  {
    id: 'acc_bowtie_pink',
    name: 'Pajarita rosa',
    desc: 'Pajarita elegante en rosa oscuro.',
    emoji: '🎀',
    src: '/accessory-bowtie-pink.png',
    price: 70,
    isBase: false,
    isBowTie: true,
  },
  {
    id: 'acc_bowtie_gray',
    name: 'Pajarita gris',
    desc: 'Pajarita sobria en gris antracita.',
    emoji: '🎀',
    src: '/accessory-bowtie-gray.png',
    price: 70,
    isBase: false,
    isBowTie: true,
  },
  {
    id: 'acc_bowtie_white',
    name: 'Pajarita blanca',
    desc: 'Pajarita de gala en blanco total.',
    emoji: '🎀',
    src: '/accessory-bowtie-white.png',
    price: 70,
    isBase: false,
    isBowTie: true,
  },
  {
    id: 'acc_bowtie_black',
    name: 'Pajarita negra',
    desc: 'Pajarita clásica en negro absoluto.',
    emoji: '🎀',
    src: '/accessory-bowtie-black.png',
    price: 70,
    isBase: false,
    isBowTie: true,
  },
];

// ── Catálogo de PIES / CALZADO (sub-categoría de Outfit) ──────────────────────
export const MASCOT_FEET = [
  {
    id: 'feet_none',
    name: 'Sin calzado',
    desc: 'La mascota sin nada en los pies.',
    emoji: '✨',
    src: null,
    price: 0,
    isBase: true,
  },
  {
    id: 'feet_sneaker_1',
    name: 'Zapatillas retro gris piedra',
    desc: 'Estilo baloncesto clásico en blanco y gris, suela de goma.',
    emoji: '👟',
    src: '/outfit-feet-1.png',
    price: 70,
    isBase: false,
    isBasic: true,
  },
  {
    id: 'feet_sneaker_1_navy',
    name: 'Zapatillas retro azul marino',
    desc: 'Misma silueta retro que las gris piedra, en azul marino.',
    emoji: '👟',
    src: '/outfit-feet-5.png',
    price: 70,
    isBase: false,
    isBasic: true,
  },
  {
    id: 'feet_sneaker_1_wine',
    name: 'Zapatillas retro burdeos',
    desc: 'Misma silueta retro que las gris piedra, en burdeos.',
    emoji: '👟',
    src: '/outfit-feet-6.png',
    price: 70,
    isBase: false,
    isBasic: true,
  },
  {
    id: 'feet_sneaker_1_olive',
    name: 'Zapatillas retro verde oliva',
    desc: 'Misma silueta retro que las gris piedra, en verde oliva.',
    emoji: '👟',
    src: '/outfit-feet-7.png',
    price: 70,
    isBase: false,
    isBasic: true,
  },
  {
    id: 'feet_sneaker_1_pink',
    name: 'Zapatillas retro rosa',
    desc: 'Misma silueta retro que las gris piedra, en rosa.',
    emoji: '👟',
    src: '/outfit-feet-8.png',
    price: 70,
    isBase: false,
    isBasic: true,
  },
  {
    id: 'feet_sneaker_1_white',
    name: 'Zapatillas retro blancas',
    desc: 'Misma silueta retro que las gris piedra, en blanco total.',
    emoji: '👟',
    src: '/outfit-feet-9.png',
    price: 70,
    isBase: false,
    isBasic: true,
  },
  {
    id: 'feet_sneaker_1_black',
    name: 'Zapatillas retro negras',
    desc: 'Misma silueta retro que las gris piedra, en negro.',
    emoji: '👟',
    src: '/outfit-feet-10.png',
    price: 70,
    isBase: false,
    isBasic: true,
  },
  {
    id: 'feet_sneaker_1_yellow',
    name: 'Zapatillas retro amarillas',
    desc: 'Misma silueta retro que las gris piedra, en amarillo.',
    emoji: '👟',
    src: '/outfit-feet-11.png',
    price: 70,
    isBase: false,
    isBasic: true,
  },
  {
    id: 'feet_sneaker_1_red',
    name: 'Zapatillas retro rojas',
    desc: 'Misma silueta retro que las gris piedra, en rojo.',
    emoji: '👟',
    src: '/outfit-feet-12.png',
    price: 70,
    isBase: false,
    isBasic: true,
  },
  {
    id: 'feet_sneaker_1_brown',
    name: 'Zapatillas retro marrones',
    desc: 'Misma silueta retro que las gris piedra, en marrón.',
    emoji: '👟',
    src: '/outfit-feet-13.png',
    price: 70,
    isBase: false,
    isBasic: true,
  },
  {
    id: 'feet_sneaker_2',
    name: 'Chunky verde salvia',
    desc: 'Silueta voluminosa con detalles en verde salvia y beige.',
    emoji: '👟',
    src: '/outfit-feet-2.png',
    price: 75,
    isBase: false,
    isBasic2: true,
    // Movida un poco a la derecha: el PNG quedaba ligeramente descentrado
    // hacia la izquierda respecto al resto del calzado chunky.
    // Incrementada de 2% → 4% por petición de ajuste fino.
    offsetX: '4%',
  },
  {
    id: 'feet_sneaker_2_blue',
    name: 'Chunky azul',
    desc: 'Misma silueta chunky voluminosa, en azul y beige.',
    emoji: '👟',
    src: '/outfit-feet-14.png',
    price: 75,
    isBase: false,
    isBasic2: true,
    // Movida un poco a la derecha, mismo ajuste que el resto del grupo.
    // Incrementada de 2% → 4% por petición de ajuste fino.
    offsetX: '4%',
  },
  {
    id: 'feet_sneaker_2_pink',
    name: 'Chunky rosa',
    desc: 'Misma silueta chunky voluminosa, en rosa y beige.',
    emoji: '👟',
    src: '/outfit-feet-15.png',
    price: 75,
    isBase: false,
    isBasic2: true,
    // Movida un poco a la derecha, mismo ajuste que el resto del grupo.
    // Incrementada de 2% → 4% por petición de ajuste fino.
    offsetX: '4%',
  },
  {
    id: 'feet_sneaker_2_purple',
    name: 'Chunky morado',
    desc: 'Misma silueta chunky voluminosa, en morado y beige.',
    emoji: '👟',
    src: '/outfit-feet-16.png',
    price: 75,
    isBase: false,
    isBasic2: true,
    // Reducida: el PNG venía dibujado notablemente más grande que el resto
    // del calzado chunky del mismo grupo. Escalada a 0.73 inicialmente;
    // reducida otro 15% más (0.73 × 0.85 ≈ 0.62) y bajada un poco.
    scale: 0.62,
    offsetY: '5%',
  },
  {
    id: 'feet_sneaker_2_black',
    name: 'Chunky negra',
    desc: 'Misma silueta chunky voluminosa, en negro y beige.',
    emoji: '👟',
    src: '/outfit-feet-17.png',
    price: 75,
    isBase: false,
    isBasic2: true,
    // Movida un poco a la derecha, mismo ajuste que el resto del grupo.
    // Incrementada de 2% → 4% por petición de ajuste fino.
    offsetX: '4%',
  },
  {
    id: 'feet_sneaker_2_yellow',
    name: 'Chunky amarilla',
    desc: 'Misma silueta chunky voluminosa, en amarillo y beige.',
    emoji: '👟',
    src: '/outfit-feet-18.png',
    price: 75,
    isBase: false,
    isBasic2: true,
    // Reducida, mismo ajuste que el resto de variantes "grandes" del grupo.
    // Reducida otro 15% más (0.73 × 0.85 ≈ 0.62) y bajada un poco.
    scale: 0.62,
    offsetY: '5%',
  },
  {
    id: 'feet_sneaker_2_orange',
    name: 'Chunky naranja',
    desc: 'Misma silueta chunky voluminosa, en naranja y beige.',
    emoji: '👟',
    src: '/outfit-feet-19.png',
    price: 75,
    isBase: false,
    isBasic2: true,
    // Reducida, mismo ajuste que el resto de variantes "grandes" del grupo.
    // Reducida otro 15% más (0.73 × 0.85 ≈ 0.62) y bajada un poco.
    scale: 0.62,
    offsetY: '5%',
  },
  {
    id: 'feet_sneaker_2_brown',
    name: 'Chunky marrón',
    desc: 'Misma silueta chunky voluminosa, en marrón y beige.',
    emoji: '👟',
    src: '/outfit-feet-20.png',
    price: 75,
    isBase: false,
    isBasic2: true,
    // Reducida, mismo ajuste que el resto de variantes "grandes" del grupo.
    // Reducida otro 15% más (0.73 × 0.85 ≈ 0.62) y bajada un poco.
    scale: 0.62,
    offsetY: '5%',
  },
  {
    id: 'feet_sneaker_2_red',
    name: 'Chunky roja',
    desc: 'Misma silueta chunky voluminosa, en rojo y beige.',
    emoji: '👟',
    src: '/outfit-feet-21.png',
    price: 75,
    isBase: false,
    isBasic2: true,
    // Reducida, mismo ajuste que el resto de variantes "grandes" del grupo.
    // Reducida otro 15% más (0.73 × 0.85 ≈ 0.62) y bajada un poco.
    scale: 0.62,
    offsetY: '5%',
  },
  {
    id: 'feet_sneaker_2_white',
    name: 'Chunky blanca',
    desc: 'Misma silueta chunky voluminosa, en blanco total.',
    emoji: '👟',
    src: '/outfit-feet-22.png',
    price: 75,
    isBase: false,
    isBasic2: true,
    // Reducida (algo menos que el resto de "grandes": esta partía de un
    // tamaño ya un poco más cercano al correcto).
    // Reducida otro 15% más (0.75 × 0.85 ≈ 0.64) y bajada un poco.
    scale: 0.64,
    offsetY: '5%',
  },
  {
    id: 'feet_sneaker_2_gray',
    name: 'Chunky gris',
    desc: 'Misma silueta chunky voluminosa, en gris y beige.',
    emoji: '👟',
    src: '/outfit-feet-23.png',
    price: 75,
    isBase: false,
    isBasic2: true,
    // Igual que verde salvia/azul/rosa/negra: movida un poco a la derecha,
    // mismo ajuste que el resto de variantes de tamaño correcto del grupo.
    // Incrementada de 2% → 4% por petición de ajuste fino.
    offsetX: '4%',
  },
  {
    id: 'feet_loafer_1',
    name: 'Mocasines marrones',
    desc: 'Estilo preppy en marrón camel con interior verde salvia.',
    emoji: '🥿',
    src: '/outfit-feet-3.png',
    price: 85,
    isBase: false,
    // Bajados respecto al resto del calzado (el PNG los traía un poco altos,
    // sin tocar la base de la mascota).
    offsetY: '10%',
  },
  {
    id: 'feet_oxford_1',
    name: 'Zapatos negros',
    desc: 'Zapato formal de cordones con suela de cuero, puro clásico.',
    emoji: '👞',
    src: '/outfit-feet-4.png',
    price: 90,
    isBase: false,
    // Bajados respecto al resto del calzado (el PNG los traía un poco altos,
    // sin tocar la base de la mascota).
    offsetY: '10%',
  },
];

// ── Catálogo de CABEZA (sub-categoría de Outfit) ───────────────────────────────
export const MASCOT_HEAD = [
  {
    id: 'head_none',
    name: 'Sin gorro',
    desc: 'La mascota sin nada en la cabeza.',
    emoji: '✨',
    src: null,
    price: 0,
    isBase: true,
  },
  {
    id: 'head_cap',
    name: 'Gorra negra',
    desc: 'Estilo urbano para cualquier plan.',
    emoji: '🧢',
    src: '/accessory-cap.png',
    price: 45,
    isBase: false,
    // El PNG original trae la gorra a tamaño completo de lienzo (demasiado
    // grande); se reduce y se sube para que asiente justo encima de la
    // cabeza de la mascota, sin tapar ojos ni cejas. offsetY es relativo al
    // centrado vertical de la capa ya escalada (ver cálculo en
    // MascotDisplay.jsx), por eso el valor es grande y negativo.
    // Escala aumentada un 20% (0.33 → 0.396) manteniendo la misma posición
    // vertical final (offsetY recalculado para el nuevo tamaño).
    scale: 0.396,
    offsetY: '-35.2%',
    // Segundo grupo de carrusel de gorras ("Gorras lisas"), distinto del
    // grupo isBasic ("Gorra negra y X" con visera de color). Mismo molde
    // liso de un solo color, sin costura central ni visera bicolor.
    isBasic2: true,
  },
  {
    id: 'head_cap_pink',
    name: 'Gorra rosa',
    desc: 'Color vibrante para un look desenfadado.',
    emoji: '🧢',
    src: '/accessory-cap-pink.png',
    price: 45,
    isBase: false,
    scale: 0.396,
    offsetY: '-35.2%',
    isBasic2: true,
  },
  {
    id: 'head_cap_solid_red',
    name: 'Gorra roja',
    desc: 'Un clásico atrevido que combina con todo.',
    emoji: '🧢',
    src: '/accessory-cap-red.png',
    price: 45,
    isBase: false,
    scale: 0.396,
    offsetY: '-35.2%',
    isBasic2: true,
  },
  {
    id: 'head_cap_navy',
    name: 'Gorra azul marino',
    desc: 'Look deportivo con un toque clásico.',
    emoji: '🧢',
    src: '/accessory-cap-navy.png',
    price: 45,
    isBase: false,
    scale: 0.396,
    offsetY: '-35.2%',
    isBasic2: true,
  },
  {
    id: 'head_cap_solid_white',
    name: 'Gorra blanca',
    desc: 'Limpia y minimalista, combina con cualquier outfit.',
    emoji: '🧢',
    src: '/accessory-cap-white.png',
    price: 45,
    isBase: false,
    scale: 0.396,
    offsetY: '-35.2%',
    isBasic2: true,
  },
  {
    id: 'head_cap_solid_yellow',
    name: 'Gorra amarilla',
    desc: 'Un toque de color que llama la atención.',
    emoji: '🧢',
    src: '/accessory-cap-yellow.png',
    price: 45,
    isBase: false,
    scale: 0.396,
    offsetY: '-35.2%',
    isBasic2: true,
  },
  // Ampliación del carrusel: mismo molde con costura central y panel
  // lateral bicolor, en 6 colores nuevos. Lienzo normalizado a 900x900
  // con el mismo recuadro de contenido (67,108)-(831,790) que el resto
  // del grupo isBasic2, por eso comparten el mismo scale/offsetY.
  {
    id: 'head_cap2_gray',
    name: 'Gorra gris',
    desc: 'Tono neutro que combina con cualquier outfit.',
    emoji: '🧢',
    src: '/accessory-cap2-gray.png',
    price: 45,
    isBase: false,
    scale: 0.396,
    offsetY: '-35.2%',
    isBasic2: true,
  },
  {
    id: 'head_cap2_green',
    name: 'Gorra verde',
    desc: 'Look fresco con un punto deportivo.',
    emoji: '🧢',
    src: '/accessory-cap2-green.png',
    price: 45,
    isBase: false,
    scale: 0.396,
    offsetY: '-35.2%',
    isBasic2: true,
  },
  {
    id: 'head_cap2_purple',
    name: 'Gorra morada',
    desc: 'Un color atrevido para destacar entre la multitud.',
    emoji: '🧢',
    src: '/accessory-cap2-purple.png',
    price: 45,
    isBase: false,
    scale: 0.396,
    offsetY: '-35.2%',
    isBasic2: true,
  },
  {
    id: 'head_cap2_orange',
    name: 'Gorra naranja',
    desc: 'Energía y color para un look que no pasa desapercibido.',
    emoji: '🧢',
    src: '/accessory-cap2-orange.png',
    price: 45,
    isBase: false,
    scale: 0.396,
    offsetY: '-35.2%',
    isBasic2: true,
  },
  {
    id: 'head_cap2_brown',
    name: 'Gorra marrón',
    desc: 'Estilo cálido y terroso, ideal para el día a día.',
    emoji: '🧢',
    src: '/accessory-cap2-brown.png',
    price: 45,
    isBase: false,
    scale: 0.396,
    offsetY: '-35.2%',
    isBasic2: true,
  },
  {
    id: 'head_cap2_navy',
    name: 'Gorra azul marino',
    desc: 'Look deportivo bicolor con un toque clásico.',
    emoji: '🧢',
    src: '/accessory-cap2-navy.png',
    price: 45,
    isBase: false,
    scale: 0.396,
    offsetY: '-35.2%',
    isBasic2: true,
  },
  {
    id: 'head_fedora',
    name: 'Sombrero de fieltro',
    desc: 'Estilo detective clásico con raya diplomática y hebilla.',
    emoji: '🎩',
    src: '/outfit-head-2.png',
    price: 70,
    isBase: false,
  },
  {
    id: 'head_cap_red',
    name: 'Gorra negra y roja',
    desc: 'Visera roja a juego, para destacar con estilo.',
    emoji: '🧢',
    src: '/outfit-head-3.png',
    price: 50,
    isBase: false,
    isBasic: true,
  },
  {
    id: 'head_cap_black',
    name: 'Gorra negra total',
    desc: 'Visera negra a juego, para un look monocromo.',
    emoji: '🧢',
    src: '/outfit-head-8.png',
    price: 50,
    isBase: false,
    isBasic: true,
  },
  {
    id: 'head_cap_white',
    name: 'Gorra negra y blanca',
    desc: 'Visera blanca a juego, contraste limpio y deportivo.',
    emoji: '🧢',
    src: '/outfit-head-9.png',
    price: 50,
    isBase: false,
    isBasic: true,
  },
  {
    id: 'head_cap_purple',
    name: 'Gorra negra y morada',
    desc: 'Visera morada a juego, un toque diferente y atrevido.',
    emoji: '🧢',
    src: '/outfit-head-10.png',
    price: 50,
    isBase: false,
    isBasic: true,
  },
  {
    id: 'head_cap_grey',
    name: 'Gorra negra y gris',
    desc: 'Visera gris a juego, versátil para cualquier look.',
    emoji: '🧢',
    src: '/outfit-head-11.png',
    price: 50,
    isBase: false,
    isBasic: true,
  },
  {
    id: 'head_cap_blue',
    name: 'Gorra negra y azul',
    desc: 'Visera azul a juego, un clásico que nunca falla.',
    emoji: '🧢',
    src: '/outfit-head-12.png',
    price: 50,
    isBase: false,
    isBasic: true,
  },
  {
    id: 'head_cap_brown',
    name: 'Gorra negra y marrón',
    desc: 'Visera marrón a juego, estilo cálido y terroso.',
    emoji: '🧢',
    src: '/outfit-head-13.png',
    price: 50,
    isBase: false,
    isBasic: true,
  },
  {
    id: 'head_cap_orange',
    name: 'Gorra negra y naranja',
    desc: 'Visera naranja a juego, máxima energía y color.',
    emoji: '🧢',
    src: '/outfit-head-14.png',
    price: 50,
    isBase: false,
    isBasic: true,
  },
  {
    id: 'head_cap_yellow',
    name: 'Gorra negra y amarilla',
    desc: 'Visera amarilla a juego, llamativa y desenfadada.',
    emoji: '🧢',
    src: '/outfit-head-15.png',
    price: 50,
    isBase: false,
    isBasic: true,
  },
  {
    id: 'head_cap_green',
    name: 'Gorra negra y verde',
    desc: 'Visera verde a juego, un toque fresco y natural.',
    emoji: '🧢',
    src: '/outfit-head-16.png',
    price: 50,
    isBase: false,
    isBasic: true,
  },
  {
    id: 'head_conical',
    name: 'Sombrero cónico de paja',
    desc: 'Tejido artesanal de bambú, fresco y tradicional.',
    emoji: '👒',
    src: '/outfit-head-4.png',
    price: 60,
    isBase: false,
  },
  {
    id: 'head_halo',
    name: 'Halo de luz',
    desc: 'Aureola luminosa flotante, para la mascota más angelical.',
    emoji: '😇',
    src: '/outfit-head-5.png',
    price: 95,
    isBase: false,
    // El PNG no es cuadrado (anillo elíptico, ratio ancho:alto ≈ 990:537),
    // así que no usa scale/offsetY (pensado para overlays cuadrados como la
    // gorra). En su lugar define una caja explícita: flota un poco por
    // encima de la coronilla de la mascota, centrada horizontalmente.
    // Tamaño reducido un 30% (75%→52.5% de ancho) manteniendo la proporción
    // y el mismo top; left recalculado para seguir centrado.
    box: {
      left: '23.75%',
      top: '-5%',
      width: '52.5%',
      height: '28.49%',
    },
  },
  {
    id: 'head_party',
    name: 'Gorro de fiesta',
    desc: 'Cono de lunares con flecos metálicos, modo celebración activado.',
    emoji: '🎉',
    src: '/outfit-head-6.png',
    price: 55,
    isBase: false,
    // PNG aislado (sin alinear al lienzo estándar de las demás prendas de
    // cabeza), recortado y centrado en un lienzo cuadrado 1024×1024 con
    // fondo eliminado. El gorro queda en el centro vertical del lienzo, así
    // que se sube bastante (offsetY muy negativo) para que asiente justo
    // encima de la cabeza, igual que el resto de prendas. Subido un poco más
    // (-35.6% → -39.6%).
    scale: 1,
    offsetY: '-39.6%',
  },
  {
    id: 'head_beret',
    name: 'Boina gris',
    desc: 'Boina clásica ladeada, un toque chic y desenfadado.',
    emoji: '🫥',
    src: '/outfit-head-7.png',
    price: 65,
    isBase: false,
    // Mismo tratamiento que el gorro de fiesta: PNG aislado centrado en
    // lienzo cuadrado 1024×1024, se sube con offsetY para asentar sobre la
    // cabeza de la mascota. Reducida un 25% (scale 1 → 0.75); offsetY
    // recalculado para el nuevo tamaño y que siga asentando en el mismo
    // sitio sobre la cabeza (-31.3% → -27.7%). Movida un pelín a la
    // izquierda (offsetX), un ajuste muy sutil.
    scale: 0.75,
    offsetY: '-27.7%',
    offsetX: '-1.5%',
  },
];

// ── Catálogo de ACTIVIDADES (capa 6: la más delantera) ─────────────────────────
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
    scale: 0.9,   // 10% más pequeño
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
    scale: 0.85,    // 15% más pequeño
    offsetX: 3,     // un poco a la derecha (puntos porcentuales)
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

// ── Mascota base por tier (capa 1: la más trasera) ────────────────────────────
export const MASCOT_BASE = {
  high: '/mascot-high.png',
  mid:  '/mascot-mid.png',
  low:  '/mascot-low.png',
};

// ── Ajuste visual de la capa de OUTFIT por subcategoría ───────────────────────
// `scale`    → tamaño de la capa outfit como múltiplo de la capa base (1 = 100%).
//              El valor histórico (sin distinción de subcategoría) era 1.05.
// `offsetX`  → desplazamiento horizontal extra en puntos porcentuales, ENCIMA
//              del centrado automático. Positivo = se mueve a la derecha.
// Usado por MascotDisplay tanto en la tienda como en la vista principal
// (la mascota de la pantalla de batería usa el mismo getMascotLayers()).
export const OUTFIT_VISUAL_ADJUST = {
  // Camisetas: 20% más pequeñas que el histórico, otro 10% más, y ahora un
  // 1.5% adicional (dentro del rango 1-2% pedido) para que no se vean tan
  // largas por abajo (1.05 → 0.84 → 0.756 → 0.74466). El primer ajuste de
  // offsetX (+0.3) se pasó de largo hacia la derecha, así que ahora se
  // corrige con un empujoncito mucho más sutil hacia la izquierda.
  camiseta: { scale: 1.05 * 0.8 * 0.9 * 0.985, offsetX: -0.04 },
  // Camisas: 15% más pequeñas que el histórico, y luego otro 10% más
  // (1.05 → 0.8925 → 0.80325). Offset a la derecha muy ligero, ajustado fino
  // tras varias rondas de feedback para que quede bien centrada.
  camisa:   { scale: 1.05 * 0.85 * 0.9, offsetX: 0.4 },
};

// ── Estado por defecto ────────────────────────────────────────────────────────
const DEFAULT_UNLOCKED_ACTIVITIES  = new Set(MASCOT_ACTIVITIES.filter(a => a.isBase).map(a => a.id));
const DEFAULT_UNLOCKED_ACCESSORIES = new Set(MASCOT_ACCESSORIES.filter(a => a.isBase).map(a => a.id));
const DEFAULT_UNLOCKED_OUTFITS     = new Set(MASCOT_OUTFITS.filter(o => o.isBase).map(o => o.id));
const DEFAULT_UNLOCKED_FEET        = new Set(MASCOT_FEET.filter(f => f.isBase).map(f => f.id));
const DEFAULT_UNLOCKED_HEAD        = new Set(MASCOT_HEAD.filter(h => h.isBase).map(h => h.id));

function isSameAccessoryGroup(a, b) {
  return Boolean(a && b && (
    (a.isChain && b.isChain) ||
    (a.isGrillz && b.isGrillz) ||
    (a.isGlasses && b.isGlasses) ||
    (a.isTie && b.isTie) ||
    (a.isBowTie && b.isBowTie)
  ));
}

function accessoryLayerRank(accessory) {
  if (accessory.isGlasses) return 10;
  if (accessory.isChain) return 20;
  if (accessory.isGrillz) return 30;
  if (accessory.isTie) return 40;
  if (accessory.isBowTie) return 50;
  return 60;
}

// ── Context ───────────────────────────────────────────────────────────────────
const MascotContext = createContext(null);

export function MascotProvider({ children }) {
  const [unlockedActivities,  setUnlockedActivities]  = useState(DEFAULT_UNLOCKED_ACTIVITIES);
  const [unlockedAccessories, setUnlockedAccessories] = useState(DEFAULT_UNLOCKED_ACCESSORIES);
  const [unlockedOutfits,     setUnlockedOutfits]     = useState(DEFAULT_UNLOCKED_OUTFITS);
  const [unlockedFeet,        setUnlockedFeet]        = useState(DEFAULT_UNLOCKED_FEET);
  const [unlockedHead,        setUnlockedHead]        = useState(DEFAULT_UNLOCKED_HEAD);

  const [activeActivity,  setActiveActivity]  = useState('none');
  // Los accesorios admiten selección múltiple y simultánea (p. ej. gafas +
  // cadena + corbata a la vez), por eso se guardan en un Set en vez de un
  // único id. 'acc_none' nunca se guarda dentro del Set: significa "vacío".
  // Excepción: cadenas, grillz, gafas de sol, corbatas y pajaritas son cada
  // uno un grupo de selección única (solo una cadena / un grillz / unas
  // gafas / una corbata / una pajarita a la vez), aunque sí se pueden
  // combinar libremente entre grupos distintos — ver `toggleAccessory`. Los
  // ids 'acc_*_none' (uno por grupo) tampoco se guardan nunca en el Set:
  // representan ese grupo vacío, igual que 'acc_none' representa todos los
  // grupos vacíos.
  const [activeAccessories, setActiveAccessories] = useState(new Set());
  const [activeOutfit,    setActiveOutfit]    = useState('out_none');
  const [activeFeet,      setActiveFeet]      = useState('feet_none');
  const [activeHead,      setActiveHead]      = useState('head_none');

  // Personalización extrema de color — receta de zonas por ítem de
  // calzado (ver comentario junto a FEET_CUSTOMIZATIONS_STORAGE_KEY).
  const [feetCustomizations, setFeetCustomizations] = useState(loadFeetCustomizations);

  // Personalización extrema de color — gorros/prendas de cabeza.
  // Misma arquitectura que feetCustomizations: cada personalización es un
  // ítem independiente con id `head_custom_<timestamp>`, no una receta
  // aplicada sobre el modelo original del catálogo.
  const [headCustomizations, setHeadCustomizations] = useState(loadHeadCustomizations);

  // Personalización extrema de color — torso (camisetas/camisas).
  const [outfitCustomizations, setOutfitCustomizations] = useState(
    () => loadStoredCustomizations(OUTFIT_CUSTOMIZATIONS_STORAGE_KEY)
  );

  // Personalización extrema de color — accesorios.
  const [accessoryCustomizations, setAccessoryCustomizations] = useState(
    () => loadStoredCustomizations(ACCESSORY_CUSTOMIZATIONS_STORAGE_KEY)
  );

  const [savedOutfits, setSavedOutfits] = useState(loadSavedOutfits);

  const customAccessoryItems = Object.values(accessoryCustomizations);
  const allAccessories = [...MASCOT_ACCESSORIES, ...customAccessoryItems];

  // Actividades
  function unlockActivity(id) {
    setUnlockedActivities(prev => new Set([...prev, id]));
  }
  function equipActivity(id) {
    setActiveActivity(id);
  }

  // Accesorios — selección múltiple y simultánea (toggle on/off por id),
  // salvo cadenas/grillz/gafas/corbatas/pajaritas, que son grupos de
  // selección única entre sí (cada uno con su propia opción "Sin X").
  function unlockAccessory(id) {
    setUnlockedAccessories(prev => new Set([...prev, id]));
  }
  function equipAccessory(id) {
    // Compatibilidad: "equipar" un accesorio lo activa (sin desactivar los
    // demás), ya que ahora pueden llevarse varios a la vez. Los ítems base
    // ("Sin accesorio" y los "Sin X" por grupo — gafas/cadena/grillz/
    // corbata/pajarita) representan "vacío" y nunca se guardan en el Set:
    // en vez de añadirse, limpian su grupo (o todo, en el caso de
    // 'acc_none').
    const item = allAccessories.find(a => a.id === id);
    if (id === 'acc_none') {
      setActiveAccessories(new Set());
      return;
    }
    if (item?.isBase) {
      setActiveAccessories(prev => {
        const next = new Set(prev);
        allAccessories.forEach(other => {
          if (isSameAccessoryGroup(item, other)) next.delete(other.id);
        });
        return next;
      });
      return;
    }
    setActiveAccessories(prev => new Set([...prev, id]));
  }
  function toggleAccessory(id) {
    if (id === 'acc_none') return;
    const item = allAccessories.find(a => a.id === id);
    // Los ítems "Sin X" de cada grupo (gafas/cadena/grillz/corbata/
    // pajarita) son la representación visual de "ninguno equipado en este
    // grupo": pulsarlos limpia el grupo en vez de añadirse al Set de
    // accesorios activos (igual que 'acc_none' limpia todos los grupos).
    if (item?.isBase) {
      setActiveAccessories(prev => {
        const next = new Set(prev);
        allAccessories.forEach(other => {
          if (isSameAccessoryGroup(item, other)) next.delete(other.id);
        });
        return next;
      });
      return;
    }
    setActiveAccessories(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        // Cadenas, grillz, gafas de sol, corbatas y pajaritas son grupos de
        // selección única: al activar uno, se desactivan automáticamente
        // los demás del mismo grupo (no afecta a los accesorios de otros
        // grupos, que siguen pudiendo combinarse libremente).
        if (item?.isChain || item?.isGrillz || item?.isGlasses || item?.isTie || item?.isBowTie) {
          allAccessories.forEach(other => {
            if (other.id === id) return;
            if (isSameAccessoryGroup(item, other)) next.delete(other.id);
          });
        }
        next.add(id);
      }
      return next;
    });
  }
  function unequipAccessory(id) {
    setActiveAccessories(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  // Outfits — Torso (camiseta/camisa)
  function unlockOutfit(id) {
    setUnlockedOutfits(prev => new Set([...prev, id]));
  }
  function equipOutfit(id) {
    setActiveOutfit(id);
  }

  // Outfits — Pies
  function unlockFeet(id) {
    setUnlockedFeet(prev => new Set([...prev, id]));
  }
  function equipFeet(id) {
    setActiveFeet(id);
  }

  // Personalización extrema de color — ahora cada personalización es un
  // ÍTEM INDEPENDIENTE (ver comentario junto a FEET_CUSTOMIZATIONS_STORAGE_KEY
  // arriba del archivo), no una receta aplicada sobre el modelo original.
  //
  // `getFeetZones(id)` sigue existiendo para que MascotDisplay/el editor
  // sigan pudiendo leer "las zonas guardadas para este id" sin cambiar su
  // forma de consumo: ahora simplemente mira si `id` es uno de los ítems
  // personalizados (en cuyo caso devuelve sus zonas) — el modelo ORIGINAL
  // nunca tiene zonas asociadas a su propio id, así que nunca se recolorea.
  function getFeetZones(id) {
    return feetCustomizations[id]?.zones ?? [];
  }

  // `saveFeetCustomization` crea (o actualiza, si se le pasa un
  // `existingCustomId` de una personalización ya existente) un ítem de
  // calzado personalizado nuevo a partir de `baseItem` (el ítem original del
  // catálogo) y la receta `zones`. El ítem original NUNCA se modifica: solo
  // se usa como plantilla (src, offsets, escala) para el nuevo ítem.
  // Devuelve el id final del ítem personalizado (nuevo o reutilizado), para
  // que quien llame pueda equiparlo inmediatamente si quiere.
  function saveFeetCustomization(baseItem, zones, existingCustomId = null) {
    if (!zones || zones.length === 0) return null;
    const id = existingCustomId ?? `feet_custom_${Date.now()}`;
    const baseId = existingCustomId
      ? (feetCustomizations[existingCustomId]?.baseId ?? baseItem.id)
      : baseItem.id;
    const baseName = existingCustomId
      ? (feetCustomizations[existingCustomId]?.baseName ?? baseItem.name)
      : baseItem.name;
    const entry = {
      id,
      baseId,
      baseName,
      name: `${baseName} (personalizada)`,
      desc: `Personalización de "${baseName}".`,
      emoji: baseItem.emoji,
      src: baseItem.src,
      zones,
      price: 0,
      offsetX: baseItem.offsetX ?? null,
      offsetY: baseItem.offsetY ?? null,
      scale: baseItem.scale ?? null,
    };
    setFeetCustomizations(prev => {
      const next = { ...prev, [id]: entry };
      try { localStorage.setItem(FEET_CUSTOMIZATIONS_STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
    // El ítem personalizado se desbloquea automáticamente: el usuario ya
    // "pagó" por el calzado original, esto es solo una variante de color.
    setUnlockedFeet(prev => new Set([...prev, id]));
    return id;
  }

  // Elimina por completo un ítem de calzado personalizado (ya no es una
  // "receta sobre el original" que se pueda vaciar a [] — directamente deja
  // de existir como ítem). Si era el calzado actualmente equipado, vuelve a
  // "Sin calzado".
  function removeFeetCustomization(id) {
    setFeetCustomizations(prev => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      try { localStorage.setItem(FEET_CUSTOMIZATIONS_STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
    setActiveFeet(current => (current === id ? 'feet_none' : current));
  }

  // Lista de ítems de calzado personalizados, en forma de objetos
  // compatibles con el catálogo MASCOT_FEET (mismas props que usan las
  // tarjetas de la tienda: src, name, emoji, offsetX/offsetY/scale…), para
  // poder reutilizar FeetCard/MascotDisplay sin distinguir su origen.
  function getCustomFeetItems() {
    return Object.values(feetCustomizations);
  }

  // Compatibilidad: ya no existe "resetear zonas de un id" (el id de un
  // ítem personalizado SOLO existe mientras tiene zonas), así que restaurar
  // equivale directamente a borrar esa personalización.
  function resetFeetZones(id) {
    removeFeetCustomization(id);
  }
  function hasFeetCustomization(id) {
    return Boolean(feetCustomizations[id]);
  }

  // Personalización extrema de color — gorros (misma arquitectura que pies).

  function getHeadZones(id) {
    return headCustomizations[id]?.zones ?? [];
  }

  // Crea (o actualiza, si se le pasa un `existingCustomId`) un ítem de
  // cabeza personalizado a partir de `baseItem` y la receta `zones`.
  // El ítem original del catálogo NUNCA se modifica.
  // Devuelve el id final del ítem personalizado.
  function saveHeadCustomization(baseItem, zones, existingCustomId = null) {
    if (!zones || zones.length === 0) return null;
    const id       = existingCustomId ?? `head_custom_${Date.now()}`;
    const baseId   = existingCustomId
      ? (headCustomizations[existingCustomId]?.baseId ?? baseItem.id)
      : baseItem.id;
    const baseName = existingCustomId
      ? (headCustomizations[existingCustomId]?.baseName ?? baseItem.name)
      : baseItem.name;
    const entry = {
      id,
      baseId,
      baseName,
      name:   `${baseName} (personalizada)`,
      desc:   `Personalización de "${baseName}".`,
      emoji:  baseItem.emoji,
      src:    baseItem.src,
      zones,
      price:  0,
      scale:   baseItem.scale   ?? null,
      offsetX: baseItem.offsetX ?? null,
      offsetY: baseItem.offsetY ?? null,
      box:     baseItem.box     ?? null,
    };
    setHeadCustomizations(prev => {
      const next = { ...prev, [id]: entry };
      try { localStorage.setItem(HEAD_CUSTOMIZATIONS_STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
    // Se desbloquea automáticamente (el usuario ya tenía el original).
    setUnlockedHead(prev => new Set([...prev, id]));
    return id;
  }

  // Elimina un ítem de cabeza personalizado. Si era el activo, vuelve a
  // "Sin prenda" (head_none).
  function removeHeadCustomization(id) {
    setHeadCustomizations(prev => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      try { localStorage.setItem(HEAD_CUSTOMIZATIONS_STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
    setActiveHead(current => (current === id ? 'head_none' : current));
  }

  // Lista de ítems de cabeza personalizados, compatible con MASCOT_HEAD.
  function getCustomHeadItems() {
    return Object.values(headCustomizations);
  }

  function hasHeadCustomization(id) {
    return Boolean(headCustomizations[id]);
  }

  // Personalización extrema de color — torso (camisetas/camisas).
  function getOutfitZones(id) {
    return outfitCustomizations[id]?.zones ?? [];
  }

  function saveOutfitCustomization(baseItem, zones, existingCustomId = null) {
    if (!baseItem || !zones || zones.length === 0) return null;
    const current = existingCustomId ? outfitCustomizations[existingCustomId] : null;
    const id = existingCustomId ?? `outfit_custom_${Date.now()}`;
    const baseId = current?.baseId ?? baseItem.baseId ?? baseItem.id;
    const baseName = current?.baseName ?? baseItem.baseName ?? baseItem.name;
    const entry = {
      id,
      baseId,
      baseName,
      name: `${baseName} (personalizada)`,
      desc: `Personalización de "${baseName}".`,
      emoji: baseItem.emoji,
      src: baseItem.src,
      zones,
      price: 0,
      subcategory: baseItem.subcategory,
      offsetY: baseItem.offsetY ?? null,
      scale: baseItem.scale ?? null,
    };
    setOutfitCustomizations(prev => {
      const next = { ...prev, [id]: entry };
      try { localStorage.setItem(OUTFIT_CUSTOMIZATIONS_STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
    setUnlockedOutfits(prev => new Set([...prev, id]));
    return id;
  }

  function removeOutfitCustomization(id) {
    setOutfitCustomizations(prev => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      try { localStorage.setItem(OUTFIT_CUSTOMIZATIONS_STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
    setActiveOutfit(current => (current === id ? 'out_none' : current));
  }

  function getCustomOutfitItems() {
    return Object.values(outfitCustomizations);
  }

  function hasOutfitCustomization(id) {
    return Boolean(outfitCustomizations[id]);
  }

  // Personalización extrema de color — accesorios.
  function getAccessoryZones(id) {
    return accessoryCustomizations[id]?.zones ?? [];
  }

  function saveAccessoryCustomization(baseItem, zones, existingCustomId = null) {
    if (!baseItem || !zones || zones.length === 0) return null;
    const current = existingCustomId ? accessoryCustomizations[existingCustomId] : null;
    const id = existingCustomId ?? `accessory_custom_${Date.now()}`;
    const baseId = current?.baseId ?? baseItem.baseId ?? baseItem.id;
    const baseName = current?.baseName ?? baseItem.baseName ?? baseItem.name;
    const entry = {
      id,
      baseId,
      baseName,
      name: `${baseName} (personalizado)`,
      desc: `Personalización de "${baseName}".`,
      emoji: baseItem.emoji,
      src: baseItem.src,
      zones,
      price: 0,
      scale: baseItem.scale ?? null,
      isChain: Boolean(baseItem.isChain),
      isGrillz: Boolean(baseItem.isGrillz),
      isGlasses: Boolean(baseItem.isGlasses),
      isTie: Boolean(baseItem.isTie),
      isBowTie: Boolean(baseItem.isBowTie),
    };
    setAccessoryCustomizations(prev => {
      const next = { ...prev, [id]: entry };
      try { localStorage.setItem(ACCESSORY_CUSTOMIZATIONS_STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
    setUnlockedAccessories(prev => new Set([...prev, id]));
    return id;
  }

  function removeAccessoryCustomization(id) {
    setAccessoryCustomizations(prev => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      try { localStorage.setItem(ACCESSORY_CUSTOMIZATIONS_STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
    setActiveAccessories(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function getCustomAccessoryItems() {
    return Object.values(accessoryCustomizations);
  }

  function hasAccessoryCustomization(id) {
    return Boolean(accessoryCustomizations[id]);
  }

  // Outfits — Cabeza
  function unlockHead(id) {
    setUnlockedHead(prev => new Set([...prev, id]));
  }
  function equipHead(id) {
    setActiveHead(id);
  }

  function saveCurrentOutfit() {
    const outfit = {
      id: `saved_outfit_${Date.now()}`,
      name: `Outfit ${savedOutfits.length + 1}`,
      createdAt: new Date().toISOString(),
      activeActivity,
      activeAccessories: [...activeAccessories],
      activeOutfit,
      activeFeet,
      activeHead,
    };

    setSavedOutfits(prev => {
      const next = [outfit, ...prev].slice(0, 20);
      try { localStorage.setItem(SAVED_OUTFITS_STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });

    return outfit;
  }

  function applySavedOutfit(outfit) {
    if (!outfit) return;

    const accessoryIds = Array.isArray(outfit.activeAccessories) ? outfit.activeAccessories : [];

    setActiveActivity(outfit.activeActivity ?? 'none');
    setActiveOutfit(outfit.activeOutfit ?? 'out_none');
    setActiveFeet(outfit.activeFeet ?? 'feet_none');
    setActiveHead(outfit.activeHead ?? 'head_none');
    setActiveAccessories(new Set(accessoryIds));

    setUnlockedActivities(prev => new Set([...prev, outfit.activeActivity].filter(Boolean)));
    setUnlockedOutfits(prev => new Set([...prev, outfit.activeOutfit].filter(Boolean)));
    setUnlockedFeet(prev => new Set([...prev, outfit.activeFeet].filter(Boolean)));
    setUnlockedHead(prev => new Set([...prev, outfit.activeHead].filter(Boolean)));
    setUnlockedAccessories(prev => new Set([...prev, ...accessoryIds]));
  }

  function removeSavedOutfit(id) {
    setSavedOutfits(prev => {
      const next = prev.filter(outfit => outfit.id !== id);
      try { localStorage.setItem(SAVED_OUTFITS_STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  /**
   * Devuelve las capas para renderizar la mascota completa dado un tier:
   *   Capa 1 → base        (mascota según batería)
   *   Capa 2 → feet        (pies: calzado)                 ← NUEVA
   *   Capa 3 → outfit      (torso: camiseta/camisa)
   *   Capa 4 → head        (cabeza: gorra…)                ← NUEVA (antes era accessory)
   *   Capa 5 → accessory   (gafas, cadena, grillz…)
   *   Capa 6 → layers      (actividad: ajedrez, balón…)
   */
  function getMascotLayers(tier) {
    const base    = MASCOT_BASE[tier] ?? MASCOT_BASE.mid;
    const outfit  = MASCOT_OUTFITS.find(o => o.id === activeOutfit) ?? outfitCustomizations[activeOutfit] ?? null;
    // El calzado activo puede ser un ítem del catálogo (MASCOT_FEET) o un
    // ítem de calzado PERSONALIZADO (feetCustomizations), que no vive en el
    // catálogo porque no es un molde nuevo: es una variante de color del
    // usuario sobre un molde existente (ver saveFeetCustomization arriba).
    const feet    = MASCOT_FEET.find(f => f.id === activeFeet) ?? feetCustomizations[activeFeet] ?? null;
    const head    = MASCOT_HEAD.find(h => h.id === activeHead) ?? headCustomizations[activeHead] ?? null;
    const accs    = allAccessories
      .filter(a => activeAccessories.has(a.id))
      .sort((a, b) => accessoryLayerRank(a) - accessoryLayerRank(b));
    const act     = MASCOT_ACTIVITIES.find(a => a.id === activeActivity);
    return {
      base,
      outfitId:           outfit?.id ?? null,
      outfit:             outfit?.src ?? null,
      outfitSubcategory:  outfit?.subcategory ?? null,
      outfitItemOffsetY:  outfit?.offsetY ?? null,
      outfitItemScale:    outfit?.scale ?? null,
      feet:             feet?.src ?? null,
      feetId:           feet?.id ?? null,
      feetOffsetY:      feet?.offsetY ?? null,
      feetOffsetX:      feet?.offsetX ?? null,
      feetScale:        feet?.scale ?? null,
      head:             head?.src ?? null,
      headId:           head?.id  ?? null,
      headScale:        head?.scale ?? null,
      headOffsetY:      head?.offsetY ?? null,
      headOffsetX:      head?.offsetX ?? null,
      headBox:          head?.box ?? null,
      // Lista de accesorios activos (selección múltiple simultánea).
      accessories:      accs,
      layers:           act?.layers ?? [],
      activityScale:    act?.scale   ?? null,
      activityOffsetX:  act?.offsetX ?? null,
    };
  }

  // Compatibilidad hacia atrás
  function getActiveSrc(tier) {
    return MASCOT_BASE[tier] ?? MASCOT_BASE.mid;
  }

  const unlocked = new Set([
    ...unlockedActivities,
    ...unlockedAccessories,
    ...unlockedOutfits,
    ...unlockedFeet,
    ...unlockedHead,
    ...Object.keys(outfitCustomizations),
    ...Object.keys(accessoryCustomizations),
  ]);

  return (
    <MascotContext.Provider value={{
      unlocked,
      unlockedActivities,
      unlockedAccessories,
      unlockedOutfits,
      unlockedFeet,
      unlockedHead,
      activeActivity,
      activeAccessories,
      activeOutfit,
      activeFeet,
      activeHead,
      unlockActivity,
      unlockAccessory,
      unlockOutfit,
      unlockFeet,
      unlockHead,
      equipActivity,
      equipAccessory,
      toggleAccessory,
      unequipAccessory,
      equipOutfit,
      equipFeet,
      equipHead,
      getMascotLayers,
      getActiveSrc,
      feetCustomizations,
      getFeetZones,
      saveFeetCustomization,
      removeFeetCustomization,
      getCustomFeetItems,
      resetFeetZones,
      hasFeetCustomization,
      headCustomizations,
      getHeadZones,
      saveHeadCustomization,
      removeHeadCustomization,
      getCustomHeadItems,
      hasHeadCustomization,
      outfitCustomizations,
      getOutfitZones,
      saveOutfitCustomization,
      removeOutfitCustomization,
      getCustomOutfitItems,
      hasOutfitCustomization,
      accessoryCustomizations,
      getAccessoryZones,
      saveAccessoryCustomization,
      removeAccessoryCustomization,
      getCustomAccessoryItems,
      hasAccessoryCustomization,
      savedOutfits,
      saveCurrentOutfit,
      applySavedOutfit,
      removeSavedOutfit,
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
