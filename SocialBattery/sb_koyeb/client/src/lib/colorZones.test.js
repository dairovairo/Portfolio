// Tests unitarios de client/src/lib/colorZones.js — la lógica pura de
// personalización de colores de la mascota. Correr con:
//
//   node --test client/src/lib/colorZones.test.js
//
// El módulo depende de <canvas> real para loadImageData/applyColorZones,
// pero las piezas ALGORÍTMICAS son puras y sí se pueden probar:
//   - hexToHslDegrees / hslDegreesToHex: conversores de color usados en
//     el selector cuadrado tono×saturación del editor.
//   - hslToRgb: la parte inversa que también trabaja en 0..1.
//   - floodFillMask: opera sobre un ImageData que se puede fabricar a
//     mano (es un dict con width/height/data:Uint8ClampedArray).
//   - recolorWithMask: idem — se le pasa un ImageData y una máscara.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hslToRgb,
  hexToHslDegrees,
  hslDegreesToHex,
  floodFillMask,
  recolorWithMask,
  applyColorZones,
} from './colorZones.js';

// ─── Conversores hex ↔ HSL en grados ──────────────────────────────────
test('hexToHslDegrees: rojo puro → h=0, s=100, l=50', () => {
  assert.deepEqual(hexToHslDegrees('#ff0000'), { h: 0, s: 100, l: 50 });
});

test('hexToHslDegrees: verde puro → h=120, s=100, l=50', () => {
  assert.deepEqual(hexToHslDegrees('#00ff00'), { h: 120, s: 100, l: 50 });
});

test('hexToHslDegrees: azul puro → h=240, s=100, l=50', () => {
  assert.deepEqual(hexToHslDegrees('#0000ff'), { h: 240, s: 100, l: 50 });
});

test('hexToHslDegrees: blanco → s=0, l=100 (h indefinido, cae a 0)', () => {
  assert.deepEqual(hexToHslDegrees('#ffffff'), { h: 0, s: 0, l: 100 });
});

test('hexToHslDegrees: negro → s=0, l=0', () => {
  assert.deepEqual(hexToHslDegrees('#000000'), { h: 0, s: 0, l: 0 });
});

test('hexToHslDegrees: gris medio → s=0, l=50', () => {
  const hsl = hexToHslDegrees('#808080');
  assert.equal(hsl.s, 0);
  // 0x80 / 0xff ≈ 0.502 → l redondeado
  assert.ok(Math.abs(hsl.l - 50) <= 1);
});

test('hexToHslDegrees: acepta formato corto (#f00)', () => {
  assert.deepEqual(hexToHslDegrees('#f00'), { h: 0, s: 100, l: 50 });
});

// ─── Round-trip: hex → hsl_deg → hex ──────────────────────────────────
test('round-trip hex→hsl→hex: colores puros se preservan', () => {
  for (const hex of ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff']) {
    const { h, s, l } = hexToHslDegrees(hex);
    assert.equal(hslDegreesToHex(h, s, l), hex, `no preserva ${hex}`);
  }
});

test('round-trip: colores intermedios se preservan (permitimos ±1 por redondeo)', () => {
  for (const hex of ['#8a4b2c', '#3b7fc2', '#c02a90', '#5e9f47']) {
    const { h, s, l } = hexToHslDegrees(hex);
    const back = hslDegreesToHex(h, s, l);
    // Los componentes RGB pueden perder ±1 por redondeos sucesivos.
    const parseHex = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const [r1, g1, b1] = parseHex(hex);
    const [r2, g2, b2] = parseHex(back);
    assert.ok(Math.abs(r1 - r2) <= 2 && Math.abs(g1 - g2) <= 2 && Math.abs(b1 - b2) <= 2,
      `${hex} → ${back} pierde demasiado`);
  }
});

// ─── hslDegreesToHex: normalización de tono ───────────────────────────
test('hslDegreesToHex: hue negativo se normaliza módulo 360', () => {
  // -120 = 240 (azul).
  assert.equal(hslDegreesToHex(-120, 100, 50), '#0000ff');
});

test('hslDegreesToHex: hue > 360 se normaliza', () => {
  // 360 + 120 = verde.
  assert.equal(hslDegreesToHex(480, 100, 50), '#00ff00');
});

test('hslDegreesToHex: hue = 0 y hue = 360 son el mismo color (rojo)', () => {
  assert.equal(hslDegreesToHex(0, 100, 50), hslDegreesToHex(360, 100, 50));
});

// ─── hslToRgb (versión interna en 0..1) ───────────────────────────────
test('hslToRgb: sin saturación produce gris (r=g=b)', () => {
  const [r, g, b] = hslToRgb(0.5, 0, 0.6);
  assert.equal(r, g);
  assert.equal(g, b);
  assert.ok(r > 100 && r < 200); // aprox 60% de 255
});

test('hslToRgb: saturación total y luminosidad media reproducen los primarios', () => {
  const [r1] = hslToRgb(0, 1, 0.5);
  assert.equal(r1, 255); // rojo
  const [, g2] = hslToRgb(1 / 3, 1, 0.5);
  assert.equal(g2, 255); // verde
  const [, , b3] = hslToRgb(2 / 3, 1, 0.5);
  assert.equal(b3, 255); // azul
});

// ─── floodFillMask ────────────────────────────────────────────────────
// Helper: construye un ImageData sintético con la forma { width, height, data }.
// data es RGBA lineal — 4 bytes por píxel.
function makeImageData(pixels) {
  // `pixels` es un array 2D de [r,g,b,a] o null (transparente).
  const height = pixels.length;
  const width = pixels[0].length;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixels[y][x] || [0, 0, 0, 0];
      const idx = (y * width + x) * 4;
      data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = a;
    }
  }
  return { width, height, data };
}

// Cuenta cuántos píxeles hay marcados en la máscara.
const countMask = (m) => m.reduce((n, v) => n + (v ? 1 : 0), 0);

test('flood: pixel semilla transparente → null (no se puede empezar en el fondo)', () => {
  const img = makeImageData([[null, null], [null, null]]);
  assert.equal(floodFillMask(img, 0, 0), null);
});

test('flood: coordenadas fuera de rango → null', () => {
  const R = [255, 0, 0, 255];
  const img = makeImageData([[R, R], [R, R]]);
  assert.equal(floodFillMask(img, -1, 0), null);
  assert.equal(floodFillMask(img, 0, 5), null);
});

test('flood: cuadrado de color uniforme → marca todos los píxeles', () => {
  const R = [255, 0, 0, 255];
  const img = makeImageData([[R, R, R], [R, R, R], [R, R, R]]);
  const mask = floodFillMask(img, 1, 1, 30);
  assert.equal(countMask(mask), 9);
});

test('flood: región separada por un anillo transparente NO se cuela al fondo', () => {
  // El transparente hace de pared. El flood desde (1,1) debe marcar
  // solo el centro (1 píxel).
  const R = [255, 0, 0, 255];
  const T = null;
  const img = makeImageData([
    [T, T, T],
    [T, R, T],
    [T, T, T],
  ]);
  const mask = floodFillMask(img, 1, 1);
  assert.equal(countMask(mask), 1);
});

test('flood: dos manchas del mismo color pero separadas por transparente → solo se pinta la conectada', () => {
  const R = [255, 0, 0, 255];
  const T = null;
  const img = makeImageData([
    [R, R, T, R, R],
    [R, R, T, R, R],
  ]);
  const maskLeft = floodFillMask(img, 0, 0);
  assert.equal(countMask(maskLeft), 4, 'solo la mancha izquierda (4 píxeles)');
  const maskRight = floodFillMask(img, 3, 0);
  assert.equal(countMask(maskRight), 4, 'solo la mancha derecha');
});

test('flood: tolerance amplia expande, tolerance estrecha limita', () => {
  const R = [255, 0, 0, 255];
  const R2 = [220, 0, 0, 255]; // rojo similar (Δ = 35)
  const img = makeImageData([[R, R2, R]]);
  // Con tolerance=10 (10² = 100) NO llega (Δ² = 35² = 1225 > 100).
  const strict = floodFillMask(img, 0, 0, 10);
  assert.equal(countMask(strict), 1);
  // Con tolerance=50 (50² = 2500 > 1225) sí llega.
  const loose = floodFillMask(img, 0, 0, 50);
  assert.equal(countMask(loose), 3);
});

test('flood: no atraviesa píxeles con alpha < 10', () => {
  const R = [255, 0, 0, 255];
  const Rghost = [255, 0, 0, 5]; // rojo pero casi invisible → pared
  const img = makeImageData([[R, Rghost, R]]);
  const mask = floodFillMask(img, 0, 0);
  assert.equal(countMask(mask), 1); // no llega al tercero
});

// ─── recolorWithMask ──────────────────────────────────────────────────
test('recolor: repinta solo los píxeles marcados, deja los demás intactos', () => {
  const R = [255, 0, 0, 255];
  const B = [0, 0, 255, 255];
  const img = makeImageData([[R, R, R]]);
  const mask = new Uint8Array([1, 0, 1]);
  recolorWithMask(img, mask, '#0000ff');
  // Píxel 0 y 2 repintados (aprox azul con la luminosidad del rojo).
  // Píxel 1 intacto: sigue siendo rojo puro.
  assert.equal(img.data[4], 255); // r del píxel 1
  assert.equal(img.data[5], 0);   // g del píxel 1
  assert.equal(img.data[6], 0);   // b del píxel 1
  // Píxel 0 ya no es puro rojo — su matiz debe ser azul (b > r).
  assert.ok(img.data[2] > img.data[0], 'píxel 0 debe tener más azul que rojo');
  void B; // silenciar linter si aplicara
});

test('recolor: preserva la luminosidad relativa entre píxeles (sombras se mantienen)', () => {
  // El módulo publicita esto: recolor sustituye matiz y saturación, pero
  // deja la luminosidad. Un píxel claro y otro oscuro deben terminar
  // manteniendo su relación tras el repintado.
  const light = [200, 200, 200, 255]; // gris claro
  const dark  = [50, 50, 50, 255];    // gris oscuro
  const img = makeImageData([[light, dark]]);
  const mask = new Uint8Array([1, 1]);
  recolorWithMask(img, mask, '#ff0000'); // repintar todo en rojo
  const lightLuma = (img.data[0] + img.data[1] + img.data[2]) / 3;
  const darkLuma  = (img.data[4] + img.data[5] + img.data[6]) / 3;
  assert.ok(lightLuma > darkLuma,
    `luminosidad debe preservarse: light=${lightLuma}, dark=${darkLuma}`);
});

test('recolor: máscara vacía → no toca nada', () => {
  const R = [255, 0, 0, 255];
  const img = makeImageData([[R, R]]);
  const before = Array.from(img.data);
  recolorWithMask(img, new Uint8Array([0, 0]), '#0000ff');
  assert.deepEqual(Array.from(img.data), before);
});

// ─── applyColorZones — el único caso que NO toca canvas ───────────────
test('applyColorZones: sin zonas → devuelve la misma src (early return, no toca canvas)', async () => {
  const src = 'data:image/png;base64,abc';
  const out = await applyColorZones(src, []);
  assert.equal(out, src);
});

test('applyColorZones: zones null → mismo comportamiento (defensa)', async () => {
  const src = 'data:image/png;base64,abc';
  const out = await applyColorZones(src, null);
  assert.equal(out, src);
});
