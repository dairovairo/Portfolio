// ─────────────────────────────────────────────────────────────────────────
// Lecturas completas contra PostgREST
// ─────────────────────────────────────────────────────────────────────────
// PostgREST corta cualquier respuesta a 1.000 filas sin avisar, y un .in()
// con cientos de UUID revienta el tamaño de la URL. Cualquier consulta que
// pueda crecer con el número de usuarios debe pasar por aquí.

const PAGE_SIZE = 1000;
const IN_CHUNK = 150;

/**
 * @param {() => object} build  Crea la consulta. Debe llevar un .order() por
 *   columnas únicas para que las páginas no se solapen.
 */
async function fetchAll(build, { pageSize = PAGE_SIZE } = {}) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await build().range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

function chunk(list, size = IN_CHUNK) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Consulta con .in() troceado; cada trozo también se pagina. */
async function selectInChunks(ids, build, { size = IN_CHUNK } = {}) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  const rows = [];
  for (const part of chunk(unique, size)) {
    rows.push(...await fetchAll(() => build(part)));
  }
  return rows;
}

module.exports = { fetchAll, selectInChunks, chunk, PAGE_SIZE, IN_CHUNK };
