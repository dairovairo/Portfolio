/**
 * MascotPreviewOverlay — pinta el PNG "horneado" (users.mascot_preview_url)
 * encima de la mascota base en tarjetas de amigo, grupos, quedadas,
 * localizador de eventos, perfiles ajenos, etc.
 *
 * Los bakes "v2" (ver lib/mascotRenderer.js → renderMascotOverlayBlob) se
 * generan sobre un lienzo con un margen (MASCOT_OVERLAY_PAD) por cada lado
 * para que las capas que sobresalen del cuadro de la mascota (p. ej. la
 * riñonera) no se recorten. Al mostrarlos hay que "des-acolchar": la imagen
 * se agranda a (1 + 2·pad)·100% y se desplaza -pad·100% en ambos ejes, de
 * modo que el cuadro central del PNG coincida exactamente con el cuadro de
 * la mascota base. Así el resultado es píxel a píxel el mismo que la ruta
 * CSS de MascotDisplay (tienda / vista principal).
 *
 * Las previews antiguas (subidas antes del cambio, sin padding) se detectan
 * por la URL — no contienen el marcador "-v2" — y se muestran como siempre
 * (inset-0), para no romperlas hasta que cada usuario vuelva a hornear la
 * suya (MascotPreviewSync lo hace en cuanto abre la app y cambia algo, o al
 * primer sync tras desplegar).
 */
import { MASCOT_OVERLAY_PAD, MASCOT_OVERLAY_V2_MARKER } from '../lib/mascotRenderer';

function isPaddedOverlay(src) {
  return typeof src === 'string' && src.includes(MASCOT_OVERLAY_V2_MARKER);
}

// Estilo de posicionamiento del overlay según su versión. Exportado también
// como helper para los sitios que generan HTML como string (p. ej. los
// marcadores de Leaflet en GlobeLocationView.jsx).
export function mascotOverlayStyle(src) {
  if (isPaddedOverlay(src)) {
    const padPct = MASCOT_OVERLAY_PAD * 100;
    const sizePct = 100 + padPct * 2;
    return {
      left: `${-padPct}%`,
      top: `${-padPct}%`,
      width: `${sizePct}%`,
      height: `${sizePct}%`,
    };
  }
  return { left: 0, top: 0, width: '100%', height: '100%' };
}

// Versión string-CSS del helper anterior, para markup construido a mano.
export function mascotOverlayInlineStyle(src) {
  const s = mascotOverlayStyle(src);
  return `position:absolute;left:${s.left};top:${s.top};width:${s.width};height:${s.height};object-fit:contain;pointer-events:none;`;
}

export default function MascotPreviewOverlay({ src }) {
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      className="absolute object-contain select-none pointer-events-none"
      style={mascotOverlayStyle(src)}
    />
  );
}
