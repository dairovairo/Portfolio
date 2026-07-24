const supabase = require('./supabase');

// Rutas en Storage cuyo prefijo empieza por el user id, y por tanto se
// pueden eliminar de forma segura al borrar la cuenta sin colisionar con
// contenido compartido de otros. Ver los sitios de subida en:
//   - server/routes/users.js  (avatars, mascot-previews)
//   - server/routes/community.js  (event-covers, event-updates, community-covers)
//   - server/routes/pools.js  (pool-covers)
//
// NO se limpian aquí (a propósito):
//   - chat-images subidas a `dm/{userId}/...` — porque el destinatario del
//     chat también las tiene en su vista y borrarlas dejaría huecos en su
//     historial. Los mensajes en sí ya se borran en cascada por la BD; el
//     archivo bajo storage lo cubrirá un job periódico de "objetos sin
//     referencia" (pendiente).
//   - community-posts / raffle-images / raffle-prizes — están indexados
//     por communityId/raffleId, no por userId, así que se limpian con la
//     comunidad/sorteo cuando se eliminan esos. Si el usuario era el
//     dueño de una comunidad, la comunidad NO se borra en cascada al
//     eliminar la cuenta (creator_id es ON DELETE SET NULL); esa
//     comunidad queda "huérfana" y la moderación decide qué hacer.
//
// Cada entrada: { bucket, prefix }. `prefix` puede ser un directorio
// (termina sin barra final: list() lista lo que hay dentro) o un fichero
// concreto (se listaría el "directorio padre" y se filtraría). Aquí todos
// son directorios.
const USER_SCOPED_PATHS = (userId) => [
  { bucket: 'avatars',      prefix: `avatars/${userId}` },
  { bucket: 'avatars',      prefix: `mascot-previews/${userId}` },
  { bucket: 'avatars',      prefix: `event-covers/${userId}` },
  { bucket: 'avatars',      prefix: `event-updates/${userId}` },
  { bucket: 'avatars',      prefix: `community-covers/${userId}` },
  { bucket: 'avatars',      prefix: `pool-covers/${userId}` },
];

// Lista recursivamente los objetos bajo `prefix` en `bucket`. La API de
// Supabase Storage lista un nivel a la vez, así que hay que bajar por
// subcarpetas manualmente.
async function listAllUnder(bucket, prefix) {
  const paths = [];
  const stack = [prefix];
  while (stack.length) {
    const dir = stack.pop();
    const { data, error } = await supabase.storage.from(bucket).list(dir, {
      limit: 1000,
      offset: 0,
    });
    if (error) {
      // Prefijo inexistente devuelve data:[], no error. Un error real
      // aquí es problema de permisos o de red — lo loggeamos y seguimos
      // para no bloquear el borrado de la cuenta por un bucket vacío.
      console.warn(`[purgeUserStorage] list falló en ${bucket}/${dir}:`, error.message);
      continue;
    }
    for (const item of data || []) {
      // Los "directorios" en Supabase Storage tienen id null.
      if (item.id === null) {
        stack.push(`${dir}/${item.name}`);
      } else {
        paths.push(`${dir}/${item.name}`);
      }
    }
  }
  return paths;
}

// Borra en Storage todos los objetos que pertenecen exclusivamente al
// usuario dado. No lanza si algo falla — el borrado de la cuenta debe
// seguir adelante aunque queden ficheros huérfanos (los recogerá un job
// posterior). Devuelve un resumen por bucket.
async function purgeUserStorage(userId) {
  const summary = {};
  for (const { bucket, prefix } of USER_SCOPED_PATHS(userId)) {
    try {
      const paths = await listAllUnder(bucket, prefix);
      if (!paths.length) {
        summary[prefix] = 0;
        continue;
      }
      // remove() acepta lotes; 1000 es el tope típico. Partimos por si
      // acaso.
      let deleted = 0;
      for (let i = 0; i < paths.length; i += 500) {
        const batch = paths.slice(i, i + 500);
        const { error } = await supabase.storage.from(bucket).remove(batch);
        if (error) {
          console.error(`[purgeUserStorage] remove falló en ${bucket}:`, error.message);
        } else {
          deleted += batch.length;
        }
      }
      summary[prefix] = deleted;
    } catch (err) {
      console.error(`[purgeUserStorage] excepción en ${bucket}/${prefix}:`, err);
      summary[prefix] = -1;
    }
  }
  return summary;
}

module.exports = { purgeUserStorage };
