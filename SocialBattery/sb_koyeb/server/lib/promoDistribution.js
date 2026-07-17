// Piezas de lógica pura del sistema de reparto publicitario, extraídas
// para poder probarse por separado (server/test/promoDistribution.test.js)
// sin arrastrar dependencias de Supabase.
//
//   - pickRaffleFromRatioGroups: el "grupo de 3 recursivo" que elige qué
//     avioneta de sorteo mostrar al usuario cuando tiene varios pendientes
//     de un mismo tier (Volt o Light). Vive en community.js/pickWithinTier.
//
//   - assignCandidatesBidirectional: la Ronda 2 usuario-a-usuario del
//     reparto de notificaciones Premium/Ultra, con preferencia
//     bidireccional por match de intereses. Vive en eventPromoPacing.js.
//
// Ambos son deterministas dados sus inputs y no tocan BD ni red — el
// caller es quien resuelve datos (sortedIds, ratioById, interestsByUser…)
// y aquí solo se toma la decisión.

const { BOOST_GROUP_SIZE } = require('./adaptiveBoost');

// ── Reparto de la avioneta de sorteos (community.js/pickWithinTier) ────
//
// Recorre los sorteos pendientes de un usuario en un mismo tier (Volt o
// Light), en GRUPOS FIJOS de BOOST_GROUP_SIZE por peor ratio, y devuelve
// el sorteo a servirle. Retorna null si ningún grupo llega a resolver,
// para que el caller caiga a su fallback cronológico (rows[0]).
//
// Reglas por grupo:
//   1) Si alguno del grupo coincide con los intereses del usuario, gana
//      el de PEOR RATIO de entre los que coinciden.
//   2) Si ninguno coincide, gana el de PEOR RATIO de los servibles del
//      grupo. Los "no servibles" son los sorteos banner_interested_only
//      (contratan targeting duro, no se les puede mostrar a un usuario
//      que no matchea; en Volt esta lista es siempre vacía porque Volt
//      no tiene banner_interested_only).
//   3) Si todos los del grupo son banner_interested_only y ninguno
//      matchea, se pasa al SIGUIENTE grupo de 3 y se repite.
//
// El caller pasa `matchesCategory(row)` y `isRestricted(row)` como
// callbacks — dependen del row concreto y del contexto del usuario,
// mantenerlos fuera preserva la pureza de esta función.
function pickRaffleFromRatioGroups({
  sortedIds,
  rowsById,
  ratioById,
  matchesCategory,
  isRestricted,
  groupSize = BOOST_GROUP_SIZE,
}) {
  const byWorstRatio = (a, b) =>
    (ratioById.get(a.raffle.id) ?? 0) - (ratioById.get(b.raffle.id) ?? 0);

  for (let start = 0; start < sortedIds.length; start += groupSize) {
    const groupIds = sortedIds.slice(start, start + groupSize);
    const groupRows = groupIds.map(id => rowsById.get(id)).filter(Boolean);

    const groupMatches = groupRows.filter(matchesCategory);
    if (groupMatches.length) {
      groupMatches.sort(byWorstRatio);
      return groupMatches[0];
    }

    const groupServable = groupRows.filter(row => !isRestricted(row));
    if (groupServable.length) {
      groupServable.sort(byWorstRatio);
      return groupServable[0];
    }
    // Todo el grupo es interested_only sin match → siguiente grupo.
  }
  return null;
}

// ── Match bidireccional de eventos (eventPromoPacing.js, Ronda 2) ──────
//
// Recorre el pool de candidatos usuario-a-usuario. Por cada candidato:
//   1. Elegibles = eventos SIN filtro duro del grupo con hueco
//      (remaining > 0) y que no lo tienen excluido.
//   2. Si el candidato tiene intereses cargados y alguno de los
//      elegibles COINCIDE con esos intereses, gana el de PEOR RATIO de
//      entre los que coinciden.
//   3. Si ninguno coincide (o no hay intereses cargados), gana el de
//      PEOR RATIO de los elegibles sin sesgo.
//   4. Si no hay ningún elegible (todos los eventos con cupo lleno o
//      excluyendo al usuario), el candidato pasa a `stillAvailable`
//      para que lo consuma el siguiente grupo (recursivo).
//
// eventMetas se espera en orden de PEOR RATIO PRIMERO (matching[0] y
// eligible[0] son el peor ratio del subconjunto). Debe contener solo
// eventos SIN filtro duro; los eventos con audience_interested_only
// ya se resuelven en la Ronda 1 del caller.
//
// La función MUTA meta.chosen (push) y meta.remaining (decremento). No
// usa aleatoriedad — es determinista dados los inputs. Devuelve el
// array `stillAvailable` para que el caller lo asigne a su pool.
function assignCandidatesBidirectional({ candidates, eventMetas, interestsByUser }) {
  if (!eventMetas.length || !candidates.length) return candidates.slice();
  const stillAvailable = [];
  for (const candidate of candidates) {
    const eligible = eventMetas.filter(m =>
      m.remaining > 0 && !m.excludeSet.has(candidate.userId)
    );
    if (!eligible.length) {
      stillAvailable.push(candidate);
      continue;
    }
    const userInterests = interestsByUser.get(candidate.userId);
    const matching = userInterests && userInterests.size
      ? eligible.filter(m => {
          if (!m.eventCategories.size) return false;
          for (const cat of userInterests) if (m.eventCategories.has(cat)) return true;
          return false;
        })
      : [];
    const target = matching.length ? matching[0] : eligible[0];
    target.chosen.push(candidate);
    target.remaining -= 1;
  }
  return stillAvailable;
}

/**
 * Fase 111 — Construye el clasificador de segmento que dispatchToEvent
 * congela en event_promo_notifications.matched_interest.
 *
 * Devuelve null (= "este evento no es clasificable") si el evento no tiene
 * categorías: sin categorías no hay nada que cruzar y etiquetar false sería
 * mentir — el usuario no es que NO estuviera interesado, es que la pregunta
 * no se puede formular. Lo mismo si el candidato no aparece en
 * interestsByUser (la carga paginada se cortó por error): se prefiere NULL,
 * "no lo sé", a un false inventado que ensuciaría el CTR por segmento.
 *
 * Un usuario con intereses cargados pero vacíos SÍ es un false legítimo: la
 * pregunta se puede formular y la respuesta es que no coincide.
 */
function makeInterestClassifier(eventCategories, interestsByUser) {
  if (!eventCategories?.size) return null;
  return (userId) => {
    const userInterests = interestsByUser.get(userId);
    if (!userInterests) return null;
    for (const cat of userInterests) if (eventCategories.has(cat)) return true;
    return false;
  };
}

module.exports = {
  pickRaffleFromRatioGroups,
  assignCandidatesBidirectional,
  makeInterestClassifier,
};
