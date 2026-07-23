/**
 * MascotPreviewOverlay — muestra el PNG "horneado" de la personalización de
 * otro usuario (users.mascot_preview_url) superpuesto sobre su mascota base.
 *
 * Es el ÚNICO sitio donde debe renderizarse ese overlay (tarjeta de amigo,
 * miembros de grupo/quedada, localizador de eventos, sniffer, perfil ajeno,
 * marcadores del mapa…). Antes cada vista repetía el mismo <img> inline.
 *
 * Por qué existe: los PNGs "v2" se hornean con un margen transparente de
 * MASCOT_OVERLAY_PAD a cada lado (ver lib/mascotRenderer.js →
 * renderMascotOverlayBlob) para que las capas que desbordan el cuadrado de
 * la mascota (p. ej. la riñonera) no se recorten al hornear. Al mostrarlos,
 * este componente expande el <img> exactamente lo mismo que se acolchó
 * (left/top negativos + width/height > 100%), de forma que el cuadrado
 * interior del PNG coincide 1:1 con la caja de la mascota base y el
 * contenido desbordante se ve igual que en la vista CSS (MascotDisplay).
 *
 * Compatibilidad: los PNGs antiguos (sin margen) siguen existiendo hasta
 * que cada usuario vuelva a sincronizar su preview. Se distinguen por la
 * URL: los v2 se suben a `mascot-previews/v2/…` (o llevan el marcador
 * `#mpv2` si el servidor cayó al fallback base64) — ver POST
 * /api/users/mascot-preview. Los antiguos se muestran como siempre
 * (inset:0), sin expandir.
 */
import { MASCOT_OVERLAY_PAD } from '../lib/mascotRenderer';

// ¿El PNG fue horneado con margen (v2)?
export function isPaddedMascotPreview(src) {
  return typeof src === 'string' &&
    (src.includes('mascot-previews/v2/') || src.includes('#mpv2'));
}

// Estilo de posicionamiento del <img> según versión del PNG.
function overlayBoxStyle(src) {
  if (!isPaddedMascotPreview(src)) {
    return { position: 'absolute', inset: 0, width: '100%', height: '100%' };
  }
  const padPct = MASCOT_OVERLAY_PAD * 100;
  const sizePct = 100 + padPct * 2;
  return {
    position: 'absolute',
    left: `-${padPct}%`,
    top: `-${padPct}%`,
    width: `${sizePct}%`,
    height: `${sizePct}%`,
  };
}

export default function MascotPreviewOverlay({ src }) {
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      className="object-contain select-none pointer-events-none"
      style={overlayBoxStyle(src)}
    />
  );
}

// Variante en string HTML para sitios que construyen el DOM a mano (los
// divIcon de Leaflet en GlobeLocationView.jsx). Misma lógica que arriba.
export function mascotPreviewOverlayHtml(src) {
  if (!src) return '';
  const s = overlayBoxStyle(src);
  const box = s.inset !== undefined
    ? 'position:absolute;inset:0;width:100%;height:100%;'
    : `position:absolute;left:${s.left};top:${s.top};width:${s.width};height:${s.height};`;
  return `<img src="${src}" style="${box}object-fit:contain;pointer-events:none;" />`;
}
