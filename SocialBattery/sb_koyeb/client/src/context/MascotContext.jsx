import { createContext, useContext, useState } from 'react';

// ── Catálogo de OUTFITS / TORSO (capa 3: encima de pies, debajo de cabeza) ─────
export const MASCOT_OUTFITS = [
  {
    id: 'out_none',
    name: 'Sin outfit',
    desc: 'La mascota sin ropa en el torso.',
    emoji: '✨',
    src: null,
    subcategory: 'camiseta',
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
  },
  {
    // Reducidas un 40% respecto al overlay a tamaño completo del lienzo
    // (igual que acc_glasses) — ver `scale` en MascotDisplay.jsx, capa de
    // accesorios "planos". Reducidas un 5% más (0.6 → 0.57).
    id: 'acc_glasses_gold',
    name: 'Gafas doradas',
    desc: 'Montura dorada con cristales oscuros, máximo estilo.',
    emoji: '🕶️',
    src: '/accessory-glasses-gold.png',
    price: 70,
    isBase: false,
    scale: 0.57,
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
    id: 'acc_bowtie',
    name: 'Pajarita azul marino',
    desc: 'Elegancia al máximo con pajarita de gala.',
    emoji: '🎀',
    src: '/accessory-bowtie.png',
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
    id: 'feet_sneaker_2',
    name: 'Zapatillas chunky verde salvia',
    desc: 'Silueta voluminosa con detalles en verde salvia y beige.',
    emoji: '👟',
    src: '/outfit-feet-2.png',
    price: 75,
    isBase: false,
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
  const [activeAccessories, setActiveAccessories] = useState(new Set());
  const [activeOutfit,    setActiveOutfit]    = useState('out_none');
  const [activeFeet,      setActiveFeet]      = useState('feet_none');
  const [activeHead,      setActiveHead]      = useState('head_none');

  // Actividades
  function unlockActivity(id) {
    setUnlockedActivities(prev => new Set([...prev, id]));
  }
  function equipActivity(id) {
    setActiveActivity(id);
  }

  // Accesorios — selección múltiple y simultánea (toggle on/off por id).
  function unlockAccessory(id) {
    setUnlockedAccessories(prev => new Set([...prev, id]));
  }
  function equipAccessory(id) {
    // Compatibilidad: "equipar" un accesorio lo activa (sin desactivar los
    // demás), ya que ahora pueden llevarse varios a la vez.
    if (id === 'acc_none') {
      setActiveAccessories(new Set());
      return;
    }
    setActiveAccessories(prev => new Set([...prev, id]));
  }
  function toggleAccessory(id) {
    if (id === 'acc_none') return;
    setActiveAccessories(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
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

  // Outfits — Cabeza
  function unlockHead(id) {
    setUnlockedHead(prev => new Set([...prev, id]));
  }
  function equipHead(id) {
    setActiveHead(id);
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
    const outfit  = MASCOT_OUTFITS.find(o => o.id === activeOutfit);
    const feet    = MASCOT_FEET.find(f => f.id === activeFeet);
    const head    = MASCOT_HEAD.find(h => h.id === activeHead);
    const accs    = MASCOT_ACCESSORIES.filter(a => activeAccessories.has(a.id));
    const act     = MASCOT_ACTIVITIES.find(a => a.id === activeActivity);
    return {
      base,
      outfit:             outfit?.src ?? null,
      outfitSubcategory:  outfit?.subcategory ?? null,
      outfitItemOffsetY:  outfit?.offsetY ?? null,
      outfitItemScale:    outfit?.scale ?? null,
      feet:             feet?.src ?? null,
      feetOffsetY:      feet?.offsetY ?? null,
      head:             head?.src ?? null,
      headScale:        head?.scale ?? null,
      headOffsetY:      head?.offsetY ?? null,
      headOffsetX:      head?.offsetX ?? null,
      headBox:          head?.box ?? null,
      // Lista de accesorios activos (selección múltiple simultánea).
      accessories:      accs,
      layers:           act?.layers ?? [],
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
