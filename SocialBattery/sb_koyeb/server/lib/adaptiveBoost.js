/**
 * adaptiveBoost.js — Tamaño del grupo "necesitado" (anti-inanición) para el
 * boost de prioridad por intereses/categoría, compartido entre el reparto de
 * notificaciones Premium/Ultra (eventPromoPacing.js) y el banner volador de
 * sorteos Light/Volt (community.js → computeBoostRaffleInfo).
 *
 * Fase anterior: tamaño variable (5-7) calculado con un porcentaje inverso
 * al número de activos. Se abandona: al ser variable, el propio tamaño del
 * grupo era una variable más a ajustar sin necesidad real, ya que
 * community.js ahora resuelve el caso de "grupo sin match" paginando al
 * siguiente grupo (ver más abajo) en vez de necesitar que el primer grupo
 * fuera lo bastante grande para casi garantizar un match.
 *
 * Ahora: tamaño FIJO, BOOST_GROUP_SIZE = 3, para todos los tiers (Premium,
 * Ultra, Light, Volt) y en cualquier n. Si n < 3, el grupo es simplemente
 * todos los activos disponibles.
 *
 * La paginación en bloques de 3 vive en community.js (pickWithinTier): si
 * ningún miembro del grupo de 3 más necesitado coincide con los intereses
 * del usuario, se prueba el SIGUIENTE grupo de 3 (los 3 siguientes por
 * ratio ascendente), y así sucesivamente hasta agotar la lista o encontrar
 * match — sin ese "grupo sin match" acaba en el fallback cronológico de
 * siempre (rows[0]).
 */

const BOOST_GROUP_SIZE = 3;

function computeAdaptiveBoostCount(n) {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(BOOST_GROUP_SIZE, n);
}

module.exports = { computeAdaptiveBoostCount, BOOST_GROUP_SIZE };
