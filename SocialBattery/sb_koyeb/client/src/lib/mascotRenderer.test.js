// Tests unitarios de client/src/lib/mascotRenderer.js — piezas puras del
// renderizado de la mascota. Correr con:
//
//   node --test client/src/lib/mascotRenderer.test.js
//
// El módulo dibuja en canvas real en producción, pero las decisiones
// aritméticas (pctToPx, drawContain calculando dx/dy/dw/dh) y la
// resolución de capas (resolveMascotLayers) son puras y sí se pueden
// verificar:
//
//   - pctToPx: convierte porcentajes a píxeles con defensa contra
//     valores raros. Un fallo aquí desplaza TODOS los accesorios.
//   - drawContain: replica object-fit:contain con alineación por eje.
//     Se prueba con un `ctx` fake que solo captura los argumentos de
//     drawImage.
//   - resolveMascotLayers: orquesta las llamadas al mascotApi (context)
//     y construye el objeto de capas resueltas. Con un mascotApi de
//     mentira se prueban las 5 ramas condicionales (base, outfit, feet,
//     head, accessories, activityLayers).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  pctToPx,
  drawContain,
  resolveMascotLayers,
} from './mascotRenderer.js';

// ─── pctToPx ──────────────────────────────────────────────────────────
test('pctToPx: número dentro del cuadrado (50% de 400 = 200)', () => {
  assert.equal(pctToPx(50, 400), 200);
});

test('pctToPx: 0 → 0', () => {
  assert.equal(pctToPx(0, 400), 0);
});

test('pctToPx: valor negativo (desborde por la izquierda) — sí lo permite', () => {
  // Muchos accesorios usan porcentajes negativos para colgar por fuera
  // del cuadrado (el halo, la riñonera antes de la migración a rinonBox).
  // Debe pasar tal cual, sin clampar.
  assert.equal(pctToPx(-10, 400), -40);
});

test('pctToPx: string numérica con % o sin él (parseFloat lo saca)', () => {
  assert.equal(pctToPx('50', 400), 200);
  assert.equal(pctToPx('50%', 400), 200); // parseFloat corta al %
});

test('pctToPx: null / undefined / cadena vacía → 0 (defensa)', () => {
  // El renderer usa este helper con valores del contexto que pueden
  // estar sin definir según qué item; 0 es el fallback razonable
  // (sin desplazamiento).
  assert.equal(pctToPx(null, 400), 0);
  assert.equal(pctToPx(undefined, 400), 0);
  assert.equal(pctToPx('', 400), 0);
});

test('pctToPx: string no numérica → 0 (parseFloat da NaN)', () => {
  assert.equal(pctToPx('centrado', 400), 0);
});

test('pctToPx: escala con el boxSize (mismo % da distinto absoluto)', () => {
  assert.equal(pctToPx(25, 200), 50);
  assert.equal(pctToPx(25, 800), 200);
});

// ─── drawContain ──────────────────────────────────────────────────────
// ctx fake: captura los argumentos de drawImage para inspeccionarlos.
function makeCtx() {
  const calls = [];
  return {
    calls,
    drawImage: (...args) => calls.push(args),
  };
}

test('drawContain: imagen cuadrada en rectángulo cuadrado del mismo tamaño → sin escala', () => {
  const ctx = makeCtx();
  const img = { width: 100, height: 100 };
  drawContain(ctx, img, 0, 0, 100, 100);
  const [, dx, dy, dw, dh] = ctx.calls[0];
  assert.deepEqual([dx, dy, dw, dh], [0, 0, 100, 100]);
});

test('drawContain: imagen ancha (2:1) en cuadrado → ocupa toda la anchura, se centra vertical', () => {
  // Escala = min(100/200, 100/100) = 0.5 → dw=100, dh=50 → centrada
  // vertical: dy = 0 + (100-50)/2 = 25.
  const ctx = makeCtx();
  const img = { width: 200, height: 100 };
  drawContain(ctx, img, 0, 0, 100, 100);
  const [, dx, dy, dw, dh] = ctx.calls[0];
  assert.deepEqual([dx, dy, dw, dh], [0, 25, 100, 50]);
});

test('drawContain: imagen alta (1:2) en cuadrado → ocupa toda la altura, se centra horizontal', () => {
  const ctx = makeCtx();
  const img = { width: 100, height: 200 };
  drawContain(ctx, img, 0, 0, 100, 100);
  const [, dx, dy, dw, dh] = ctx.calls[0];
  assert.deepEqual([dx, dy, dw, dh], [25, 0, 50, 100]);
});

test('drawContain: alignY=bottom pega la imagen ancha al borde inferior', () => {
  // Misma imagen ancha 2:1; con alignY=bottom, dy debe ir a boxSize - dh.
  const ctx = makeCtx();
  const img = { width: 200, height: 100 };
  drawContain(ctx, img, 0, 0, 100, 100, 'center', 'bottom');
  const [, , dy, , dh] = ctx.calls[0];
  assert.equal(dy + dh, 100);
});

test('drawContain: alignX=left pega la imagen alta al borde izquierdo', () => {
  const ctx = makeCtx();
  const img = { width: 100, height: 200 };
  drawContain(ctx, img, 0, 0, 100, 100, 'left', 'center');
  const [, dx] = ctx.calls[0];
  assert.equal(dx, 0);
});

test('drawContain: respeta el offset base (x, y)', () => {
  const ctx = makeCtx();
  const img = { width: 100, height: 100 };
  drawContain(ctx, img, 50, 30, 100, 100);
  const [, dx, dy] = ctx.calls[0];
  assert.equal(dx, 50);
  assert.equal(dy, 30);
});

test('drawContain: img sin dimensiones → no dibuja (defensa)', () => {
  const ctx = makeCtx();
  drawContain(ctx, null, 0, 0, 100, 100);
  drawContain(ctx, { width: 0, height: 100 }, 0, 0, 100, 100);
  drawContain(ctx, { width: 100, height: 100 }, 0, 0, 0, 100);
  assert.equal(ctx.calls.length, 0);
});

// ─── resolveMascotLayers ──────────────────────────────────────────────
// Mock mínimo del mascotApi que expone useMascot() en producción.
// Devuelve zonas vacías por defecto (no dispara applyColorZones que
// necesitaría canvas).
function makeMascotApi(overrides = {}) {
  const noZones = () => [];
  return {
    getMascotLayers: () => ({}),
    getFeetZones: noZones,
    getHeadZones: noZones,
    getOutfitZones: noZones,
    getAccessoryZones: noZones,
    ...overrides,
  };
}

test('resolve: sin ninguna capa equipada → todos los campos son null', async () => {
  const api = makeMascotApi();
  const out = await resolveMascotLayers('mid', api);
  assert.equal(out.outfit, null);
  assert.equal(out.feet, null);
  assert.equal(out.head, null);
  assert.deepEqual(out.accessories, []);
  assert.deepEqual(out.activityLayers, []);
});

test('resolve: base se propaga tal cual', async () => {
  const api = makeMascotApi({
    getMascotLayers: () => ({ base: '/mascot-mid.png' }),
  });
  const out = await resolveMascotLayers('mid', api);
  assert.equal(out.base, '/mascot-mid.png');
});

test('resolve: outfit con id y src produce objeto outfit con metadatos', async () => {
  const api = makeMascotApi({
    getMascotLayers: () => ({
      outfit: '/outfit-cool.png',
      outfitId: 'cool',
      outfitSubcategory: 'camiseta',
      outfitItemOffsetY: -3,
      outfitItemScale: 1.02,
    }),
  });
  const out = await resolveMascotLayers('mid', api);
  assert.equal(out.outfit.src, '/outfit-cool.png');
  assert.equal(out.outfit.subcategory, 'camiseta');
  assert.equal(out.outfit.itemOffsetY, -3);
  assert.equal(out.outfit.itemScale, 1.02);
});

test('resolve: feet con offsets propaga los ajustes visuales', async () => {
  const api = makeMascotApi({
    getMascotLayers: () => ({
      feet: '/feet.png',
      feetId: 'sneakers',
      feetOffsetY: 5,
      feetOffsetX: -1,
      feetScale: 1.1,
    }),
  });
  const out = await resolveMascotLayers('mid', api);
  assert.equal(out.feet.src, '/feet.png');
  assert.equal(out.feet.offsetY, 5);
  assert.equal(out.feet.offsetX, -1);
  assert.equal(out.feet.scale, 1.1);
});

test('resolve: head propaga box (halo usa una caja explícita, no un ancla)', async () => {
  const api = makeMascotApi({
    getMascotLayers: () => ({
      head: '/halo.png',
      headId: 'halo',
      headBox: { left: 25, top: -5, width: 50, height: 30 },
    }),
  });
  const out = await resolveMascotLayers('mid', api);
  assert.deepEqual(out.head.box, { left: 25, top: -5, width: 50, height: 30 });
});

test('resolve: accessories preserva todos los campos por accesorio + filtra los sin src', async () => {
  const api = makeMascotApi({
    getMascotLayers: () => ({
      accessories: [
        { id: 'a1', src: '/gafas.png', isRinon: false, extra: 'x' },
        { id: 'a2', src: null }, // sin src → se filtra
        { id: 'a3', src: '/rinon.png', isRinon: true, rinonBox: { left: 20 } },
      ],
    }),
  });
  const out = await resolveMascotLayers('mid', api);
  assert.equal(out.accessories.length, 2);
  assert.equal(out.accessories[0].id, 'a1');
  assert.equal(out.accessories[0].extra, 'x'); // preserva props no reconocidas
  assert.equal(out.accessories[1].id, 'a3');
  assert.deepEqual(out.accessories[1].rinonBox, { left: 20 });
});

test('resolve: activityLayers propagados junto con scale/offsetX', async () => {
  const api = makeMascotApi({
    getMascotLayers: () => ({
      layers: ['/activity-1.png', '/activity-2.png'],
      activityScale: 0.85,
      activityOffsetX: 12,
    }),
  });
  const out = await resolveMascotLayers('mid', api);
  assert.deepEqual(out.activityLayers, ['/activity-1.png', '/activity-2.png']);
  assert.equal(out.activityScale, 0.85);
  assert.equal(out.activityOffsetX, 12);
});

test('resolve: tier se propaga al getMascotLayers (respeta low/mid/high)', async () => {
  let receivedTier = null;
  const api = makeMascotApi({
    getMascotLayers: (tier) => { receivedTier = tier; return {}; },
  });
  await resolveMascotLayers('high', api);
  assert.equal(receivedTier, 'high');
});
