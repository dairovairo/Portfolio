import { useEffect, useState } from 'react';
import { applyColorZones } from '../lib/colorZones';

/**
 * useColorizedSrc — devuelve el src final de una imagen aplicando la receta
 * de "zonas de color" personalizadas del usuario (ver lib/colorZones.js).
 * Si no hay zonas guardadas para esta prenda, devuelve el src original sin
 * tocarlo. El cálculo es asíncrono (usa un <canvas> oculto), así que el
 * hook devuelve el src original al instante y lo sustituye por el
 * resultado recoloreado en cuanto está listo; como el resultado se cachea
 * por src+zonas, los renders posteriores son instantáneos.
 */
export function useColorizedSrc(src, zones) {
  const zonesKey = zones && zones.length ? JSON.stringify(zones) : '';
  const [resolved, setResolved] = useState(src);

  useEffect(() => {
    if (!src || !zonesKey) {
      setResolved(src);
      return;
    }
    let cancelled = false;
    applyColorZones(src, JSON.parse(zonesKey))
      .then(result => { if (!cancelled) setResolved(result); })
      .catch(() => { if (!cancelled) setResolved(src); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, zonesKey]);

  return resolved;
}
