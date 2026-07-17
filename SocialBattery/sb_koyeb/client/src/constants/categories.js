// ── Categorías compartidas entre Eventos, Comunidades e Intereses personales ──
// Única fuente de la verdad para las categorías de la app. Cualquier
// categoría añadida aquí queda disponible automáticamente en:
//   - el formulario de creación de eventos (CommunityPage, CommunityDetailPage)
//   - el formulario de creación de comunidades (CommunityPage)
//   - el selector de intereses del onboarding y del perfil (OnboardingPage)
// Mantener las tres en el mismo listado es lo que hace que los filtros
// "afines a mis intereses" (eventos y comunidades) funcionen correctamente:
// comparan las categorías de un evento/comunidad contra profile.interests,
// así que si un lado tiene categorías que el otro no conoce, esos elementos
// nunca podían coincidir.
//
// U+FE0F (️) tras cada emoji fuerza su presentación a color en todas las
// plataformas (el CSS global usa font-variant-emoji: text por defecto).
export const CATEGORIES = [
  { id: 'Música',     emoji: '🎵️' },
  { id: 'Deporte',    emoji: '⚽️' },
  { id: 'Arte',       emoji: '🎨️' },
  { id: 'Tecnología', emoji: '💻️' },
  { id: 'Comida',     emoji: '🍽️' },
  { id: 'Cocina',     emoji: '👨\u200d🍳️' },
  { id: 'Fiesta',     emoji: '🎉️' },
  { id: 'Naturaleza', emoji: '🌿️' },
  { id: 'Cine',       emoji: '🎬️' },
  { id: 'Juego',      emoji: '🎮️' },
  { id: 'Yoga',       emoji: '🧘️' },
  { id: 'Bienestar',  emoji: '💆️' },
  { id: 'Fotografía', emoji: '📷️' },
  { id: 'Lectura',    emoji: '📚️' },
  { id: 'Viajes',     emoji: '✈️' },
];

export const OTHER_CATEGORY = 'Otro';

// Solo los ids, en el mismo orden. Útil para construir los selectores de
// categoría de eventos/comunidades: [...CATEGORY_LABELS, OTHER_CATEGORY]
export const CATEGORY_LABELS = CATEGORIES.map(c => c.id);

function normalizeText(value = '') {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

const EMOJI_BY_NORMALIZED_ID = CATEGORIES.reduce((acc, c) => {
  acc[normalizeText(c.id)] = c.emoji;
  return acc;
}, {});

const DEFAULT_EMOJI = '🌐️';

// Sinónimos por si en datos antiguos, o en el texto libre de la categoría
// "Otro", aparece una palabra que no coincide exactamente con el id
// canónico. Cada categoría tiene un patrón que no se solapa con las demás
// (p.ej. "cocina" vs "comida" van a emojis distintos).
const EMOJI_SYNONYMS = [
  [/musica|concierto|concert/,               EMOJI_BY_NORMALIZED_ID['musica']],
  [/deporte|sport|futbol|tenis|running/,     EMOJI_BY_NORMALIZED_ID['deporte']],
  [/arte|exposicion|museo/,                  EMOJI_BY_NORMALIZED_ID['arte']],
  [/tecnologia|tech|hacking|codigo/,         EMOJI_BY_NORMALIZED_ID['tecnologia']],
  [/cocina|chef/,                            EMOJI_BY_NORMALIZED_ID['cocina']],
  [/comida|food|gastro|cena/,                EMOJI_BY_NORMALIZED_ID['comida']],
  [/fiesta|party|celebracion/,               EMOJI_BY_NORMALIZED_ID['fiesta']],
  [/naturaleza|nature|senderismo|hiking/,    EMOJI_BY_NORMALIZED_ID['naturaleza']],
  [/cine|film|pelicula|movie/,               EMOJI_BY_NORMALIZED_ID['cine']],
  [/juego|gaming|videojuego/,                EMOJI_BY_NORMALIZED_ID['juego']],
  [/yoga|meditacion/,                        EMOJI_BY_NORMALIZED_ID['yoga']],
  [/bienestar|wellness|spa/,                 EMOJI_BY_NORMALIZED_ID['bienestar']],
  [/fotografia|photo/,                       EMOJI_BY_NORMALIZED_ID['fotografia']],
  [/lectura|libro|book|literatura/,          EMOJI_BY_NORMALIZED_ID['lectura']],
  [/viajes|viaje|travel/,                    EMOJI_BY_NORMALIZED_ID['viajes']],
];

// Emoji para una categoría de evento, comunidad o interés. Usa coincidencia
// exacta contra el id canónico primero, y cae a sinónimos por si el texto
// no coincide literalmente (categorías antiguas, "Otro" con texto libre...).
export function getCategoryEmoji(category = '') {
  const c = normalizeText(category);
  if (EMOJI_BY_NORMALIZED_ID[c]) return EMOJI_BY_NORMALIZED_ID[c];
  const match = EMOJI_SYNONYMS.find(([re]) => re.test(c));
  return match ? match[1] : DEFAULT_EMOJI;
}
