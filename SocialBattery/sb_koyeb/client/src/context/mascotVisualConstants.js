// Constantes visuales puras de la mascota — extraídas del MascotContext
// para poder importarse desde lib/mascotRenderer.js sin arrastrar todo
// el árbol de React del contexto (necesario para que los tests de Node
// puedan cargar el renderer sin JSX loader).
//
// Vive aquí como .js (no .jsx) sin imports de React ni de otros módulos
// de contexto. Cualquier constante que se use TANTO en la vista CSS
// (MascotContext/MascotDisplay) COMO en el horneado a canvas
// (mascotRenderer) debe vivir aquí para que las dos rutas lean
// exactamente el mismo valor (mismo problema que resolvimos con
// rinonBox en su día — ver historial de esa constante).

// ── Ajuste visual de la capa de OUTFIT por subcategoría ───────────────
// `scale`   → tamaño de la capa outfit como múltiplo de la capa base.
// `offsetX` → desplazamiento horizontal extra en puntos porcentuales,
//             ENCIMA del centrado automático. Positivo = derecha.
export const OUTFIT_VISUAL_ADJUST = {
  // Camisetas: 20% más pequeñas que el histórico, otro 10% más, y ahora un
  // 1.5% adicional (dentro del rango 1-2% pedido) para que no se vean tan
  // largas por abajo (1.05 → 0.84 → 0.756 → 0.74466). El primer ajuste de
  // offsetX (+0.3) se pasó de largo hacia la derecha, así que ahora se
  // corrige con un empujoncito mucho más sutil hacia la izquierda.
  camiseta: { scale: 1.05 * 0.8 * 0.9 * 0.985, offsetX: -0.04 },
  // Camisas: 15% más pequeñas que el histórico, y luego otro 10% más
  // (1.05 → 0.8925 → 0.80325). Offset a la derecha muy ligero, ajustado fino
  // tras varias rondas de feedback para que quede bien centrada.
  camisa:   { scale: 1.05 * 0.85 * 0.9, offsetX: 0.4 },
};

// Caja de render por defecto para riñoneras (la de las variantes estándar,
// p. ej. la roja). Se usa como fallback si un ítem de riñonera no trae su
// propia rinonBox — p. ej. personalizaciones antiguas guardadas en
// localStorage antes de que existiera este campo. Compartida por
// MascotDisplay.jsx (vista CSS) y lib/mascotRenderer.js (horneado).
// Historial de ajustes: -30% left. Luego +5% right, +4% down, +5% tamaño
// (crecido desde el centro, para no desplazarse de más al agrandar).
// Luego +2% right, +2% down.
export const RINON_DEFAULT_BOX = { left: 20.396, top: 68.795, width: 57.984, height: 37.344 };
