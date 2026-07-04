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
  if (!mascot || !mascot.base) return;
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
      const rinonTop = 62 + (acc.rinonOffsetY ?? 0);
      drawContain(
        ctx, img,
        boxX + pctToPx(-13, boxSize), boxY + pctToPx(rinonTop, boxSize),
        pctToPx(126, boxSize), pctToPx(49, boxSize)
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
