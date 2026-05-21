/**
 * Returns Tailwind color class and hex based on battery level
 */
export function getBatteryColor(level) {
  if (level <= 15) return { tw: 'text-red-500', hex: '#ef4444', label: 'Agotado' };
  if (level <= 30) return { tw: 'text-orange-500', hex: '#f97316', label: 'Bajo' };
  if (level <= 50) return { tw: 'text-yellow-400', hex: '#facc15', label: 'Moderado' };
  if (level <= 75) return { tw: 'text-lime-400', hex: '#a3e635', label: 'Bien' };
  return { tw: 'text-green-400', hex: '#4ade80', label: 'Cargado' };
}

/**
 * Returns emoji for battery level
 */
export function getBatteryEmoji(level) {
  if (level <= 15) return '🪫';
  if (level <= 30) return '🔋';
  if (level <= 60) return '🔋';
  if (level <= 85) return '🔋';
  return '⚡';
}

/**
 * Formats "last updated" relative time
 */
export function formatRelativeTime(dateStr) {
  if (!dateStr) return 'Sin actualizar hoy';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Ahora mismo';
  if (mins < 60) return `Hace ${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Hace ${hours}h`;
  return 'Ayer o antes';
}
