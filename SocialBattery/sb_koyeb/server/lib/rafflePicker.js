// Lógica pura de selección de la avioneta a servirle a un usuario cuando
// tiene varios sorteos pendientes. Extraída de routes/community.js
// (pickWithinTier) para poderse testear sin necesidad de Supabase.
//
// Contrato — el llamador es responsable de:
//   - Filtrar `rows` al tier concreto ('community' | 'light' | 'volt').
//   - Precomputar `sortedIds` y `ratioById` (ver computeRaffleRatios más
//     abajo). En pickWithinTier estos vienen de computeBoostRaffleInfo,
//     que consulta a Supabase el nº de visualizaciones ya servidas por
//     sorteo — algo que NO puede ir aquí.
//   - Precomputar `ownCommunityIds` (Set) y `ownInterests` (Set) del
//     usuario que va a recibir la avioneta.
//
// Reglas aplicadas, en orden:
//
//   1. Si alguno de los sorteos pendientes es de una comunidad de la que
//      el usuario es miembro (ownCommunityIds), gana el más antiguo por
//      orden de asignación como target (rows[i].created_at). Es el
//      máximo criterio de relevancia personal.
//
//   2. Solo para 'volt' y 'light', y solo si el usuario tiene intereses
//      declarados, se aplica el mecanismo del "grupo de 3" con match de
//      categoría:
//        a) Se toma el grupo de los 3 más necesitados por ratio (los
//           primeros de sortedIds).
//        b) Si alguno del grupo coincide con los intereses del usuario,
//           gana el de PEOR ratio de entre esos matches.
//        c) Si ninguno coincide, gana el de peor ratio del grupo entre
//           los que se le PUEDEN servir a este usuario — o sea, los
//           sorteos con banner_interested_only se descartan (no se le
//           pueden mostrar a alguien que no matchea intereses).
//        d) Solo si el grupo entero es banner_interested_only y este
//           usuario no matchea con ninguno, se pasa al SIGUIENTE grupo
//           de 3 en sortedIds y se repite desde (a).
//
//   3. Fallback: primera fila por orden cronológico de asignación
//      (rows[0], asumiendo que rows viene ya ordenado).

function pickWithinTier({
  tier,
  rows,
  ownCommunityIds,
  ownInterests,
  sortedIds,
  ratioById,
  boostGroupSize,
}) {
  if (!Array.isArray(rows) || !rows.length) return null;

  const ownCommunityRow = rows.find(row => ownCommunityIds.has(row.raffle.community_id));
  if (ownCommunityRow) return ownCommunityRow;

  const boostable = (tier === 'volt' || tier === 'light') && ownInterests.size > 0 && Array.isArray(sortedIds) && ratioById;
  if (boostable) {
    const matchesCategory = row => (row.raffle.community?.categories || []).some(cat => ownInterests.has(cat));
    const isRestricted = row => row.raffle.banner_interested_only === true;
    const byWorstRatio = (a, b) => (ratioById.get(a.raffle.id) ?? 0) - (ratioById.get(b.raffle.id) ?? 0);
    const rowsById = new Map(rows.map(row => [row.raffle.id, row]));

    for (let start = 0; start < sortedIds.length; start += boostGroupSize) {
      const groupIds = sortedIds.slice(start, start + boostGroupSize);
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
      // Todo el grupo es interest-restricted y no matchea → siguiente grupo.
    }
  }

  return rows[0];
}

// Utilidad pura auxiliar: dado un mapa raffleId → shownCount y el tier,
// devuelve { sortedIds, ratioById } (misma forma que computeBoostRaffleInfo
// pero sin Supabase). Útil para tests.
//
// En Light el ratio es shown/contracted (cuanto más bajo, más necesitado).
// En Volt no hay aforo, se usa lo servido en crudo.
function computeRaffleRatios({ tier, raffles, shownCountById }) {
  if (!raffles.length) return { sortedIds: [], ratioById: new Map() };
  if (raffles.length === 1) {
    return { sortedIds: [raffles[0].id], ratioById: new Map([[raffles[0].id, 0]]) };
  }
  const stats = raffles.map(r => {
    const shown = shownCountById.get(r.id) || 0;
    const contracted = tier === 'light' ? (r.banner_views_contracted || null) : null;
    const ratio = contracted ? shown / contracted : shown;
    return { id: r.id, ratio };
  });
  stats.sort((a, b) => a.ratio - b.ratio);
  return {
    sortedIds: stats.map(s => s.id),
    ratioById: new Map(stats.map(s => [s.id, s.ratio])),
  };
}

module.exports = { pickWithinTier, computeRaffleRatios };
