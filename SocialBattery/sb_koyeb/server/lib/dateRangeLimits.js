// server/lib/dateRangeLimits.js
//
// Pequeños helpers para calcular los límites de fecha que aplicamos a
// eventos y quedadas:
//   - la fecha de inicio no puede quedar demasiado lejos en el futuro
//     respecto a cuándo se creó el evento/quedada.
//   - la fecha de fin no puede quedar demasiado lejos de la fecha de inicio.
//
// Se agrupan aquí porque las mismas reglas (con distintos márgenes) se usan
// tanto en server/routes/community.js (eventos) como en
// server/routes/pools.js (quedadas), tanto al crear como al editar.

function addYears(date, years) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

module.exports = { addYears, addMonths, addDays };
