/**
 * mascotRenderer — resuelve la mascota equipada (con ropa, calzado, gorro,
 * accesorios y actividad) y la dibuja sobre un <canvas>, para usarla en
 * imágenes generadas (p. ej. la historia de "Compartir mi batería").
 *
 * Replica EXACTAMENTE la lógica de composición de capas de
 * components/MascotDisplay.jsx (mismo orden, mismos porcentajes y mismas
 * fórmulas de escala/offset), pero usando <canvas> en vez de <img>/CSS, para
 * poder "hornear" la mascota dentro de una imagen PNG exportable.
 */
import { applyColorZones } from './colorZones';
import { OUTFIT_VISUAL_ADJUST } from '../context/MascotContext';

// ── Carga de imágenes con caché ────────────────────────────────────────────────
const imageCache = new Map(); // src -> Promise<HTMLImageElement|null>

function loadImage(src) {
  if (!src) return Promise.resolve(null);
  if (imageCache.has(src)) return imageCache.get(src);
  const promise = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // si falla, simplemente se omite esa capa
    img.src = src;
  });
  imageCache.set(src, promise);
  return promise;
}

async function resolveSrc(src, zones) {
  if (!src) return null;
  if (zones && zones.length) {
    try {
      return await applyColorZones(src, zones);
    } catch {
      return src;
    }
  }
  return src;
}

// ── Resolución de capas ────────────────────────────────────────────────────────

/**
 * resolveMascotLayers — a partir de un tier ('low'|'mid'|'high') y las
 * funciones del MascotContext, calcula el src final (ya recoloreado si el
 * usuario personalizó algo) de cada capa equipada actualmente.
 *
 * `mascotApi` debe incluir: getMascotLayers, getFeetZones, getHeadZones,
 * getOutfitZones, getAccessoryZones (todas provistas por useMascot()).
 */
export async function resolveMascotLayers(tier, mascotApi) {
  const { getMascotLayers, getFeetZones, getHeadZones, getOutfitZones, getAccessoryZones } = mascotApi;
  const resolved = getMascotLayers(tier);

  const [outfitSrc, feetSrc, headSrc] = await Promise.all([
    resolveSrc(resolved.outfit, resolved.outfitId ? getOutfitZones(resolved.outfitId) : null),
    resolveSrc(resolved.feet, resolved.feetId ? getFeetZones(resolved.feetId) : null),
    resolveSrc(resolved.head, resolved.headId ? getHeadZones(resolved.headId) : null),
  ]);

  const accessories = await Promise.all(
    (resolved.accessories || []).map(async (acc) => {
      const zones = acc.id ? getAccessoryZones(acc.id) : null;
      const src = await resolveSrc(acc.src, zones);
      return { ...acc, src };
    })
  );

  return {
    base: resolved.base,
    outfit: outfitSrc
      ? {
          src: outfitSrc,
          subcategory: resolved.outfitSubcategory,
          itemOffsetY: resolved.outfitItemOffsetY,
          itemScale: resolved.outfitItemScale,
        }
      : null,
    feet: feetSrc
      ? {
          src: feetSrc,
          offsetY: resolved.feetOffsetY,
          offsetX: resolved.feetOffsetX,
          scale: resolved.feetScale,
        }
      : null,
    head: headSrc
      ? {
          src: headSrc,
          scale: resolved.headScale,
          offsetY: resolved.headOffsetY,
          offsetX: resolved.headOffsetX,
          box: resolved.headBox,
        }
      : null,
    accessories: accessories.filter((a) => a.src),
    activityLayers: resolved.layers || [],
    activityScale: resolved.activityScale,
    activityOffsetX: resolved.activityOffsetX,
  };
}

// ── Helpers de dibujo ──────────────────────────────────────────────────────────

// Convierte un valor porcentual (número "37.25" o string "-35.2%") relativo
// al tamaño del lienzo de la mascota (boxSize) a píxeles absolutos.
function pctToPx(value, boxSize) {
  if (value === null || value === undefined || value === '') return 0;
  const num = typeof value === 'number' ? value : parseFloat(value);
  return Number.isNaN(num) ? 0 : (num / 100) * boxSize;
}

// Dibuja `img` dentro del rectángulo (x, y, w, h) preservando su proporción
// (equivalente a CSS object-fit: contain), alineado según alignX/alignY
// (equivalente a object-position).
function drawContain(ctx, img, x, y, w, h, alignX = 'center', alignY = 'center') {
  if (!img || !img.width || !img.height || w <= 0 || h <= 0) return;
  const scale = Math.min(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  let dx = x + (w - dw) / 2;
  let dy = y + (h - dh) / 2;
  if (alignX === 'left') dx = x;
  else if (alignX === 'right') dx = x + w - dw;
  if (alignY === 'top') dy = y;
  else if (alignY === 'bottom') dy = y + h - dh;
  ctx.drawImage(img, dx, dy, dw, dh);
}

// ── Dibujo de la mascota completa ──────────────────────────────────────────────

/**
 * drawMascotOnCanvas — dibuja la mascota resuelta (ver resolveMascotLayers)
 * dentro del cuadrado (boxX, boxY, boxSize, boxSize) del canvas `ctx`.
 * options.glowColor añade un resplandor de color detrás de la capa base
 * (equivalente al drop-shadow de glowColor en MascotDisplay).
 */
export async function drawMascotOnCanvas(ctx, mascot, boxX, boxY, boxSize, options = {}) {
  // Antes exigía `mascot.base` para dibujar cualquier cosa. Ahora `base`
  // puede venir explícitamente a `null` (ver renderMascotOverlayBlob más
  // abajo, que dibuja SOLO las capas de ropa/calzado/gorro/accesorios/
  // actividad, sin la mascota de fondo), así que solo se descarta si no hay
  // objeto `mascot` en absoluto.
  if (!mascot) return;
  const { glowColor } = options;

  const srcs = [
    mascot.base,
    mascot.outfit?.src,
    mascot.feet?.src,
    mascot.head?.src,
    ...mascot.accessories.map((a) => a.src),
    ...mascot.activityLayers,
  ].filter(Boolean);

  const imgs = {};
  await Promise.all(
    srcs.map(async (src) => {
      imgs[src] = await loadImage(src);
    })
  );

  // Capa 1: base
  const baseImg = imgs[mascot.base];
  if (baseImg) {
    if (glowColor) {
      ctx.save();
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = boxSize * 0.09;
      drawContain(ctx, baseImg, boxX, boxY, boxSize, boxSize);
      ctx.restore();
    } else {
      drawContain(ctx, baseImg, boxX, boxY, boxSize, boxSize);
    }
  }

  // Capa 2: pies / calzado
  if (mascot.feet) {
    const img = imgs[mascot.feet.src];
    if (img) {
      const { offsetX, offsetY, scale } = mascot.feet;
      if (scale) {
        const pct = scale * 100;
        const pos = (100 - pct) / 2;
        const x = boxX + pctToPx(pos, boxSize) + pctToPx(offsetX, boxSize);
        const y = boxY + pctToPx(pos, boxSize) + pctToPx(offsetY, boxSize);
        const s = pctToPx(pct, boxSize);
        drawContain(ctx, img, x, y, s, s);
      } else {
        const x = boxX + pctToPx(offsetX, boxSize);
        const y = boxY + pctToPx(offsetY, boxSize);
        drawContain(ctx, img, x, y, boxSize, boxSize);
      }
    }
  }

  // Capa 3: outfit / torso (camiseta o camisa)
  if (mascot.outfit) {
    const img = imgs[mascot.outfit.src];
    if (img) {
      const { subcategory, itemOffsetY, itemScale } = mascot.outfit;
      const adjust = OUTFIT_VISUAL_ADJUST[subcategory] ?? OUTFIT_VISUAL_ADJUST.camiseta;
      const sizePct = adjust.scale * (itemScale ?? 1) * 100;
      const centerPct = (100 - sizePct) / 2;
      const leftPct = centerPct + (adjust.offsetX ?? 0);
      const x = boxX + pctToPx(leftPct, boxSize);
      // outfitOffsetY por defecto es '20%' en MascotDisplay (vista principal)
      const y = boxY + pctToPx(centerPct, boxSize) + pctToPx('20%', boxSize) + pctToPx(itemOffsetY, boxSize);
      const s = pctToPx(sizePct, boxSize);
      drawContain(ctx, img, x, y, s, s);
    }
  }

  // Capa 4: cabeza (gorra, halo…)
  if (mascot.head) {
    const img = imgs[mascot.head.src];
    if (img) {
      const { scale, offsetX, offsetY, box } = mascot.head;
      if (box) {
        const x = boxX + pctToPx(box.left, boxSize);
        const y = boxY + pctToPx(box.top, boxSize);
        const w = pctToPx(box.width, boxSize);
        const h = pctToPx(box.height, boxSize);
        drawContain(ctx, img, x, y, w, h);
      } else if (scale) {
        const pct = scale * 100;
        const pos = (100 - pct) / 2;
        const x = boxX + pctToPx(pos, boxSize) + pctToPx(offsetX, boxSize);
        const y = boxY + pctToPx(pos, boxSize) + pctToPx(offsetY, boxSize);
        const s = pctToPx(pct, boxSize);
        drawContain(ctx, img, x, y, s, s);
      } else {
        drawContain(ctx, img, boxX, boxY, boxSize, boxSize);
      }
    }
  }

  // Capa 5: accesorio(s) — pueden combinarse varios a la vez
  for (const acc of mascot.accessories) {
    const img = imgs[acc.src];
    if (!img) continue;

    if (acc.isGrillz) {
      drawContain(
        ctx, img,
        boxX + pctToPx(37.25, boxSize), boxY + pctToPx(41, boxSize),
        pctToPx(25.5, boxSize), pctToPx(25.5, boxSize)
      );
    } else if (acc.isChain) {
      drawContain(
        ctx, img,
        boxX + pctToPx(9, boxSize), boxY + pctToPx(28, boxSize),
        pctToPx(82, boxSize), pctToPx(64, boxSize),
        'center', 'top'
      );
    } else if (acc.isTie) {
      drawContain(
        ctx, img,
        boxX + pctToPx(32, boxSize), boxY + pctToPx(54, boxSize),
        pctToPx(36, boxSize), pctToPx(72, boxSize),
        'center', 'top'
      );
    } else if (acc.isBowTie) {
      drawContain(
        ctx, img,
        boxX + pctToPx(25.25, boxSize), boxY + pctToPx(51.4, boxSize),
        pctToPx(49.5, boxSize), pctToPx(19.8, boxSize)
      );
    } else if (acc.isRinon) {
      // Ver comentario detallado en components/MascotDisplay.jsx:
      // ajuste 4 (otro 2% a la derecha respecto al ajuste 3, sin cambio de
      // tamaño): left=1.9275, top base=51.91625, width=152.145,
      // height=59.1675. IMPORTANTE: estos números deben ser IDÉNTICOS a los
      // de MascotDisplay.jsx (caja base compartida) — si divergen, la
      // riñonera se ve desplazada en las previews horneadas (tarjetas de
      // amigo, grupos, localizador…) respecto a la tienda/vista principal.
      // rinonScale/rinonOffsetX (por ítem) recentran y desplazan la caja
      // base para colores cuyo PNG tiene más margen interno — misma
      // fórmula que en MascotDisplay.jsx.
      const baseLeft = 1.9275;
      const baseTop = 51.91625 + (acc.rinonOffsetY ?? 0);
      const baseWidth = 152.145;
      const baseHeight = 59.1675;
      const scale = acc.rinonScale ?? 1;
      const rinonWidth = baseWidth * scale;
      const rinonHeight = baseHeight * scale;
      const centerX = baseLeft + baseWidth / 2;
      const centerY = baseTop + baseHeight / 2;
      const rinonLeft = centerX - rinonWidth / 2 + (acc.rinonOffsetX ?? 0);
      const rinonTop = centerY - rinonHeight / 2;
      drawContain(
        ctx, img,
        boxX + pctToPx(rinonLeft, boxSize), boxY + pctToPx(rinonTop, boxSize),
        pctToPx(rinonWidth, boxSize), pctToPx(rinonHeight, boxSize)
      );
    } else if (acc.scale) {
      const pct = acc.scale * 100;
      const pos = (100 - pct) / 2;
      drawContain(
        ctx, img,
        boxX + pctToPx(pos, boxSize), boxY + pctToPx(pos, boxSize),
        pctToPx(pct, boxSize), pctToPx(pct, boxSize)
      );
    } else {
      drawContain(ctx, img, boxX, boxY, boxSize, boxSize);
    }
  }

  // Capa 6: actividad (la más delantera)
  for (const src of mascot.activityLayers) {
    const img = imgs[src];
    if (!img) continue;
    if (mascot.activityScale) {
      const pct = mascot.activityScale * 100;
      const pos = (100 - pct) / 2;
      const leftPct = pos + (mascot.activityOffsetX ?? 0);
      drawContain(
        ctx, img,
        boxX + pctToPx(leftPct, boxSize), boxY + pctToPx(pos, boxSize),
        pctToPx(pct, boxSize), pctToPx(pct, boxSize)
      );
    } else {
      drawContain(ctx, img, boxX, boxY, boxSize, boxSize);
    }
  }
}

// ── Overlay para la tarjeta de amigos ──────────────────────────────────────────

/**
 * renderMascotOverlayBlob — genera un PNG cuadrado y transparente con SOLO
 * las capas equipadas por encima de la mascota base (calzado, torso, gorro,
 * accesorios y actividad, todas ya recoloreadas si el usuario personalizó
 * algún ítem), sin la propia mascota de fondo.
 *
 * Se sube al servidor (ver users.mascot_preview_url / POST
 * /api/users/mascot-preview) para que los amigos puedan verla en su
 * tarjeta del menú principal: FriendCard superpone este PNG sobre la
 * mascota base del TIER de cada amigo (que depende de la batería de cada
 * uno, no de quien mira), así que aquí no importa qué tier se use para
 * resolver las capas — todos los offsets/escalas son porcentuales y no
 * dependen del tier, solo la propia imagen base (que se descarta).
 *
 * Devuelve `null` si no hay ninguna capa equipada (mascota base sin
 * personalizar): en ese caso no hace falta generar ni subir nada.
 */
// Padding del overlay horneado ("v2"): algunas capas (p. ej. la riñonera,
// cuya caja llega a ~105% por la derecha y ~111% por abajo) se salen del
// cuadro de la mascota. En la ruta CSS (MascotDisplay) eso no importa —
// simplemente sobresalen del contenedor — pero en el bake antiguo el canvas
// medía exactamente boxSize y RECORTABA lo que sobresalía, con lo que la
// riñonera se veía cortada/descolocada en las tarjetas de amigo, grupos,
// localizador de eventos, etc. Solución: hornear sobre un lienzo con un 30%
// de margen por cada lado y, al mostrarlo, "des-acolchar" con CSS (ver
// components/MascotPreviewOverlay.jsx). Las previews antiguas (sin padding)
// se distinguen por la URL: las nuevas se suben a ...-v2.png.
export const MASCOT_OVERLAY_PAD = 0.3;
export const MASCOT_OVERLAY_V2_MARKER = '-v2';
// Umbral para distinguir formato por tamaño intrínseco del PNG (ver
// components/MascotPreviewOverlay.jsx): los bakes legacy miden 256px de
// lado; los v2, 256 + 2·round(256·0.3) = 410px. Cualquier valor intermedio
// sirve de frontera. Si algún día cambia el tamaño base del bake, mantener
// la invariante legacy < umbral <= v2.
export const MASCOT_OVERLAY_PADDED_MIN_PX = 320;

export async function renderMascotOverlayBlob(mascotApi, size = 256) {
  const resolved = await resolveMascotLayers('mid', mascotApi);

  const hasAnyLayer = Boolean(
    resolved.outfit ||
    resolved.feet ||
    resolved.head ||
    (resolved.accessories && resolved.accessories.length) ||
    (resolved.activityLayers && resolved.activityLayers.length)
  );
  if (!hasAnyLayer) return null;

  const pad = Math.round(size * MASCOT_OVERLAY_PAD);
  const canvasSize = size + pad * 2;

  const canvas = document.createElement('canvas');
  canvas.width = canvasSize;
  canvas.height = canvasSize;
  const ctx = canvas.getContext('2d');

  // `base: null` a propósito — ver comentario de la función. La mascota se
  // dibuja en el cuadro central (pad, pad, size): las capas que sobresalen
  // caen dentro del margen y ya no se recortan.
  await drawMascotOnCanvas(ctx, { ...resolved, base: null }, pad, pad, size);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}
