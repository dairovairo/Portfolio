/**
 * colorZones — utilidades para la personalización extrema de colores: el
 * usuario toca una zona de una prenda (p. ej. una zapatilla) y la app
 * selecciona, mediante "flood fill" por similitud de color, toda la región
 * conectada de ese mismo tono, para poder repintarla con cualquier color
 * elegido. El repintado sustituye el matiz (hue) y la saturación de cada
 * píxel por los del color elegido pero CONSERVA su luminosidad original, así
 * se mantienen intactas las sombras, brillos y el volumen del dibujo aunque
 * cambie el color base — el resultado sigue pareciendo una zapatilla real
 * de ese color, no un parche plano pegado encima.
 *
 * Las personalizaciones se guardan como una "receta" ligera: una lista de
 * zonas `{ x, y, tolerance, color }` (un punto semilla + sensibilidad de
 * selección + color elegido) en vez de la imagen final entera. La imagen
 * final siempre se puede recalcular a partir del PNG original aplicando esa
 * receta en orden, así que ocupa pocos bytes y siempre se mantiene fiel al
 * asset original (ver MascotContext.jsx → feetCustomizations).
 */

const imageCache = new Map();   // src -> Promise<HTMLImageElement>
const resultCache = new Map();  // `${src}::${JSON.stringify(zones)}` -> Promise<string dataURL>

function loadImage(src) {
  if (!imageCache.has(src)) {
    imageCache.set(src, new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    }));
  }
  return imageCache.get(src);
}

/**
 * loadImageData — decodifica (con caché) el PNG original y devuelve un
 * ImageData "fresco" e independiente cada vez que se llama, listo para
 * mutar libremente (el editor lo va modificando en memoria mientras el
 * usuario prueba colores, sin afectar a otras instancias).
 */
export async function loadImageData(src) {
  const img = await loadImage(src);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { canvas, ctx, imageData: ctx.getImageData(0, 0, canvas.width, canvas.height) };
}

function hexToRgb(hex) {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.split('').map(c => c + c).join('') : m;
  const num = parseInt(full, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

export function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b]
    .map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * hexToHslDegrees / hslDegreesToHex — variantes "en unidades humanas" de las
 * conversiones de color anteriores, pensadas para los controles del editor
 * (cuadrado tono×saturación + sliders de saturación/luminosidad): h en
 * grados (0–360), s y l en porcentaje (0–100). rgbToHsl / hslToRgb de arriba
 * siguen trabajando en 0–1 para el resto del módulo (flood fill, recolor…).
 */
export function hexToHslDegrees(hex) {
  const { r, g, b } = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslDegreesToHex(h, s, l) {
  const hue01 = (((h % 360) + 360) % 360) / 360;
  const [r, g, b] = hslToRgb(hue01, s / 100, l / 100);
  return rgbToHex(r, g, b);
}

/**
 * floodFillMask — a partir de un punto semilla (x,y), recorre la imagen
 * (BFS con pila) y marca todos los píxeles conectados cuyo color RGB esté
 * dentro de `tolerance` (distancia euclídea) del color de partida. Los
 * píxeles casi transparentes (alpha < 10) actúan de "pared": ni se marcan
 * ni se expanden a través de ellos, así el relleno respeta el contorno real
 * del dibujo y nunca se cuela en el fondo transparente.
 * Devuelve un Uint8Array del tamaño de la imagen (1 = dentro de la zona), o
 * null si el punto de partida ya es transparente.
 */
export function floodFillMask(imageData, startX, startY, tolerance = 30) {
  const { width, height, data } = imageData;
  if (startX < 0 || startY < 0 || startX >= width || startY >= height) return null;
  const startIdx = (startY * width + startX) * 4;
  if (data[startIdx + 3] < 10) return null;

  const sr = data[startIdx], sg = data[startIdx + 1], sb = data[startIdx + 2];
  const tol2 = tolerance * tolerance;
  const mask = new Uint8Array(width * height);
  const visited = new Uint8Array(width * height);
  const stack = [startY * width + startX];
  visited[stack[0]] = 1;

  while (stack.length) {
    const p = stack.pop();
    const idx = p * 4;
    if (data[idx + 3] < 10) continue;
    const dr = data[idx] - sr, dg = data[idx + 1] - sg, db = data[idx + 2] - sb;
    if (dr * dr + dg * dg + db * db > tol2) continue;
    mask[p] = 1;

    const px = p % width, py = (p - px) / width;
    if (px > 0)          { const n = p - 1;     if (!visited[n]) { visited[n] = 1; stack.push(n); } }
    if (px < width - 1)  { const n = p + 1;     if (!visited[n]) { visited[n] = 1; stack.push(n); } }
    if (py > 0)          { const n = p - width; if (!visited[n]) { visited[n] = 1; stack.push(n); } }
    if (py < height - 1) { const n = p + width; if (!visited[n]) { visited[n] = 1; stack.push(n); } }
  }
  return mask;
}

/**
 * recolorWithMask — repinta in-place los píxeles marcados en `mask`,
 * sustituyendo su matiz/saturación por los de `hexColor` pero conservando
 * la luminosidad original de cada píxel (así se respetan sombras y
 * brillos del dibujo original).
 */
export function recolorWithMask(imageData, mask, hexColor) {
  const { width, height, data } = imageData;
  const { r: tr, g: tg, b: tb } = hexToRgb(hexColor);
  const [th, ts] = rgbToHsl(tr, tg, tb);
  const total = width * height;
  for (let p = 0; p < total; p++) {
    if (!mask[p]) continue;
    const idx = p * 4;
    const [, , l] = rgbToHsl(data[idx], data[idx + 1], data[idx + 2]);
    const [nr, ng, nb] = hslToRgb(th, ts, l);
    data[idx] = nr;
    data[idx + 1] = ng;
    data[idx + 2] = nb;
  }
}

/**
 * applyColorZones — aplica una receta completa de zonas sobre el PNG
 * original y devuelve un data URL con el resultado final. Cada zona se
 * aplica sobre el resultado de las anteriores (igual que hace el editor en
 * vivo), y el resultado se cachea por combinación exacta de src + zonas
 * para no recalcular en cada render.
 */
export async function applyColorZones(src, zones) {
  if (!zones || zones.length === 0) return src;
  const cacheKey = `${src}::${JSON.stringify(zones)}`;
  if (!resultCache.has(cacheKey)) {
    resultCache.set(cacheKey, (async () => {
      const { canvas, ctx, imageData } = await loadImageData(src);
      for (const zone of zones) {
        const mask = floodFillMask(imageData, zone.x, zone.y, zone.tolerance ?? 30);
        if (mask) recolorWithMask(imageData, mask, zone.color);
      }
      ctx.putImageData(imageData, 0, 0);
      return canvas.toDataURL('image/png');
    })());
  }
  return resultCache.get(cacheKey);
}
