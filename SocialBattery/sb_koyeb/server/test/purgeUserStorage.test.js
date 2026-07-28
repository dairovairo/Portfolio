// Tests unitarios de server/lib/purgeUserStorage.js — helper que barre
// los objetos de Supabase Storage propiedad de un usuario al eliminar
// su cuenta. Correr con:
//
//   node --test server/test/purgeUserStorage.test.js
//
// El módulo hace `require('./supabase')` al top-level (cliente real con
// service key). Interceptamos ese require con require.cache ANTES de
// cargar el módulo, inyectando un stub de storage en memoria que:
//   · Simula la API list/remove de supabase.storage.from(bucket).
//   · Registra las llamadas para poder verificar batches, prefijos,
//     manejo de errores.
//   · Es mutable entre tests (setFiles / setErrorOnBucket) para no tener
//     que borrar caché ni reimportar el módulo.
//
// Es exactamente el tipo de test que dije que sería de "bajo ROI" porque
// requiere mockear I/O — pero como este helper toca datos de RGPD (borrar
// archivos del usuario al eliminar cuenta), vale la pena el trabajo.

const test = require('node:test');
const assert = require('node:assert/strict');

// ─── Stub de Supabase Storage en memoria ──────────────────────────────
const state = {
  filesByBucket: {},   // { bucketName: [absolutePath, ...] }
  errorOnBucket: null, // 'bucket' para que list() falle con error
  calls: { list: [], remove: [] },
};

function reset() {
  state.filesByBucket = {};
  state.errorOnBucket = null;
  state.calls.list = [];
  state.calls.remove = [];
}

const mockSupabase = {
  storage: {
    from(bucket) {
      return {
        async list(prefix, _opts) {
          state.calls.list.push({ bucket, prefix });
          if (state.errorOnBucket === bucket) {
            return { data: null, error: new Error('permission denied') };
          }
          const files = state.filesByBucket[bucket] || [];
          // Los inmediatamente descendientes de `prefix`: cualquier path
          // que empiece por `prefix/` y cuyo siguiente nombre sea único.
          const under = files.filter(p => p.startsWith(prefix + '/'));
          const seen = new Set();
          const items = [];
          for (const p of under) {
            const rest = p.slice(prefix.length + 1);
            const parts = rest.split('/');
            const name = parts[0];
            if (seen.has(name)) continue;
            seen.add(name);
            // id null = "carpeta" (más niveles debajo); id != null = fichero.
            items.push({ name, id: parts.length > 1 ? null : `file-${name}` });
          }
          return { data: items, error: null };
        },
        async remove(paths) {
          state.calls.remove.push({ bucket, paths: [...paths] });
          const set = new Set(paths);
          state.filesByBucket[bucket] = (state.filesByBucket[bucket] || [])
            .filter(p => !set.has(p));
          return { error: null };
        },
      };
    },
  },
};

// Inyectamos el mock ANTES de que purgeUserStorage.js haga su require.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://stub.local';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'stub-key';
const supabaseModulePath = require.resolve('../lib/supabase');
require.cache[supabaseModulePath] = {
  id: supabaseModulePath,
  filename: supabaseModulePath,
  loaded: true,
  exports: mockSupabase,
};

const { purgeUserStorage } = require('../lib/purgeUserStorage');

// Silenciar console.warn/error de la función durante los tests
// (los pintaría entre resultados y ensuciaría el reporte).
const originalWarn = console.warn;
const originalError = console.error;
test.beforeEach(() => {
  reset();
  console.warn = () => {};
  console.error = () => {};
});
test.afterEach(() => {
  console.warn = originalWarn;
  console.error = originalError;
});

// ─── Tests ────────────────────────────────────────────────────────────

test('purge: usuario sin ficheros → resumen todo a 0, remove nunca se llama', async () => {
  const summary = await purgeUserStorage('u1');
  // 6 prefijos scoped por usuario en el helper.
  assert.equal(Object.keys(summary).length, 6);
  for (const key of Object.keys(summary)) assert.equal(summary[key], 0);
  assert.equal(state.calls.remove.length, 0);
});

test('purge: lista TODOS los prefijos scoped esperados (avatars, mascot-previews, event-covers, event-updates, community-covers, pool-covers)', async () => {
  await purgeUserStorage('u1');
  const listedPrefixes = state.calls.list.map(c => c.prefix);
  for (const p of [
    'avatars/u1',
    'mascot-previews/u1',
    'event-covers/u1',
    'event-updates/u1',
    'community-covers/u1',
    'pool-covers/u1',
  ]) {
    assert.ok(listedPrefixes.includes(p), `no listó ${p}`);
  }
});

test('purge: borra un fichero directo bajo el prefijo', async () => {
  state.filesByBucket['avatars'] = ['avatars/u1/foto.png'];
  const summary = await purgeUserStorage('u1');
  assert.equal(summary['avatars/u1'], 1);
  // El fichero ya no está en el bucket.
  assert.deepEqual(state.filesByBucket['avatars'], []);
});

test('purge: solo borra los del usuario indicado, no los de otros', async () => {
  state.filesByBucket['avatars'] = [
    'avatars/u1/foto.png',
    'avatars/u2/foto.png', // otro usuario, NO se toca
  ];
  await purgeUserStorage('u1');
  // Queda solo el de u2.
  assert.deepEqual(state.filesByBucket['avatars'], ['avatars/u2/foto.png']);
});

test('purge: borra el AVATAR guardado como fichero directo "avatars/{userId}.png" (regresión — RGPD)', async () => {
  // Bug real: los avatars y mascot-previews suben a
  // avatars/{userId}.png (fichero directo dentro de avatars/), no a
  // avatars/{userId}/algo.png (subcarpeta). El helper original
  // llamaba list('avatars/u1') esperando una carpeta y NO veía el
  // fichero — resultado: los avatars quedaban huérfanos al eliminar
  // cuenta (datos personales sin borrar). Este test amarra el fix.
  state.filesByBucket['avatars'] = [
    'avatars/u1.png',
    'avatars/u2.png',
    'mascot-previews/u1.png',
  ];
  await purgeUserStorage('u1');
  assert.deepEqual(
    state.filesByBucket['avatars'].sort(),
    ['avatars/u2.png'],
    'debe quedar solo el avatar de u2'
  );
});

test('purge: borra flat-file con nombre exacto (sin extensión) también', async () => {
  // Si por algún despliegue antiguo alguien subió mascot-preview sin
  // extensión, también hay que borrarlo. Match por nombre base exacto.
  state.filesByBucket['avatars'] = ['mascot-previews/u1'];
  await purgeUserStorage('u1');
  assert.deepEqual(state.filesByBucket['avatars'], []);
});

test('purge: baja por subdirectorios (recursivo) — evento con carpetas anidadas', async () => {
  // Estructura típica de event-updates/{userId}/{eventId}/{fileName}.
  state.filesByBucket['avatars'] = [
    'event-updates/u1/evt-1/img1.png',
    'event-updates/u1/evt-1/img2.png',
    'event-updates/u1/evt-2/img3.png',
  ];
  const summary = await purgeUserStorage('u1');
  assert.equal(summary['event-updates/u1'], 3);
  assert.deepEqual(state.filesByBucket['avatars'], []);
});

test('purge: batch — divide la lista en chunks de 500 al llamar remove', async () => {
  // Fabricamos 1200 ficheros para forzar 3 batches (500 + 500 + 200).
  const paths = [];
  for (let i = 0; i < 1200; i++) paths.push(`avatars/u1/f${i}.png`);
  state.filesByBucket['avatars'] = paths;

  const summary = await purgeUserStorage('u1');
  assert.equal(summary['avatars/u1'], 1200);

  const removeCallsForAvatars = state.calls.remove.filter(c => c.bucket === 'avatars');
  const sizes = removeCallsForAvatars.map(c => c.paths.length);
  // El primer prefijo con 1200 ficheros usa 3 batches; el resto de
  // prefijos avatars son cero, así que solo hay 3 llamadas totales.
  assert.deepEqual(sizes.sort((a, b) => b - a), [500, 500, 200]);
});

test('purge: si list() falla en un bucket, sigue con los demás (no bloquea el borrado de la cuenta)', async () => {
  state.errorOnBucket = 'avatars'; // TODOS los prefijos en avatars fallan
  state.filesByBucket['avatars'] = ['avatars/u1/foto.png'];
  // No debe lanzar. Devuelve summary donde los prefijos fallidos son 0
  // (list devuelve error → se salta el prefijo, no se borra nada, pero
  // el resumen es 0, no -1: la excepción se atrapa por prefijo entero,
  // no por bucket).
  const summary = await purgeUserStorage('u1');
  assert.ok(typeof summary === 'object');
  // El fichero sigue en el bucket porque no llegamos a remove.
  assert.deepEqual(state.filesByBucket['avatars'], ['avatars/u1/foto.png']);
});

test('purge: devuelve promesa que resuelve, nunca lanza (contrato con el caller de DELETE /me)', async () => {
  state.errorOnBucket = 'avatars';
  // No lanzar aunque list falle en todos.
  await assert.doesNotReject(purgeUserStorage('u1'));
});

test('purge: no elimina un fichero con prefijo AMBIGUO — "avatars/u10/x.png" NO cuenta como del usuario "u1"', async () => {
  // Regresión importante: el filtro debe ser prefix+'/', no un
  // startsWith(prefix) suelto. Si no, borrarías datos de "u10" al
  // eliminar a "u1".
  state.filesByBucket['avatars'] = [
    'avatars/u1/foto.png',
    'avatars/u10/foto.png',  // otro user cuyo id empieza igual
    'avatars/u123/foto.png',
  ];
  await purgeUserStorage('u1');
  const remaining = state.filesByBucket['avatars'].sort();
  assert.deepEqual(remaining, ['avatars/u10/foto.png', 'avatars/u123/foto.png']);
});
