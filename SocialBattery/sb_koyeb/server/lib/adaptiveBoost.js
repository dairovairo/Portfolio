/**
 * adaptiveBoost.js — Tamaño del grupo compartido de reparto publicitario.
 *
 * BOOST_GROUP_SIZE es la única cosa que sobrevive de la fase adaptativa
 * (antes tamaño variable calculado con computeAdaptiveBoostCount, ya
 * retirada). Vale 3 y se usa en dos sitios:
 *
 *   - eventPromoPacing.js: reparto de notificaciones Premium/Ultra por
 *     ticks. Cada tick sirve los 3 eventos con peor ratio; si ese grupo
 *     no consume pool, se pasa al siguiente grupo de 3.
 *
 *   - community.js/pickWithinTier: elige qué avioneta de sorteo mostrar
 *     al usuario cuando tiene varias pendientes. Grupos de 3 por peor
 *     ratio; si el grupo actual no tiene ningún sorteo que se le pueda
 *     mostrar, se paginan al siguiente grupo de 3.
 *
 * Cambiar este valor afecta a los dos comportamientos a la vez, que es
 * lo deseable — el "grupo publicitario" es un único concepto compartido
 * entre eventos y sorteos.
 */

const BOOST_GROUP_SIZE = 3;

module.exports = { BOOST_GROUP_SIZE };
