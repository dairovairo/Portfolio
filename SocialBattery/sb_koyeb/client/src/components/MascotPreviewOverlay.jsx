/**
 * MascotPreviewOverlay — pinta el PNG "horneado" (users.mascot_preview_url)
 * encima de la mascota base en tarjetas de amigo, grupos, quedadas,
 * localizador de eventos, perfiles ajenos, etc.
 *
 * Los bakes "v2" (ver lib/mascotRenderer.js → renderMascotOverlayBlob) se
 * generan sobre un lienzo con un margen (MASCOT_OVERLAY_PAD) por cada lado
 * para que las capas que sobresalen del cuadro de la mascota (p. ej. la
 * riñonera, cuya caja llega a ~105% por la derecha y ~111% por abajo) no se
 * recorten. Al mostrarlos hay que "des-acolchar": la imagen se agranda a
 * (1 + 2·pad)·100% y se desplaza -pad·100% en ambos ejes, de modo que el
 * cuadro central del PNG coincida exactamente con el cuadro de la mascota
 * base. Así el resultado es píxel a píxel el mismo que la ruta CSS de
 * MascotDisplay (tienda / vista principal).
 *
 * DETECCIÓN DE FORMATO — por tamaño intrínseco del PNG, NO por la URL.
 * Los bakes legacy miden exactamente 256px de lado; los v2 miden 410px
 * (256 + 2·77). Se decide con naturalWidth en onLoad, comparando contra
 * MASCOT_OVERLAY_PADDED_MIN_PX. Esto es a prueba de todo lo que rompía el
 * marcador "-v2" en la URL: backend antiguo que guarda en el path legacy,
 * fallback del servidor a data-URL base64 (sin path), CDNs, service worker
 * con bundle viejo subiendo un formato u otro… el tamaño viaja SIEMPRE con
 * la propia imagen. La URL con "-v2" (si llega) solo se usa como pista
 * inicial para minimizar el reposicionamiento al cargar.
 */
import { useState } from 'react';
import {
  MASCOT_OVERLAY_PAD,
  MASCOT_OVERLAY_PADDED_MIN_PX,
  MASCOT_OVERLAY_V2_MARKER,
} from '../lib/mascotRenderer';

function guessPaddedFromUrl(src) {
  return typeof src === 'string' && src.includes(MASCOT_OVERLAY_V2_MARKER);
}

function styleFor(padded) {
  if (padded) {
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

export default function MascotPreviewOverlay({ src }) {
  // `padded` empieza con la pista de la URL y se corrige (si hace falta) en
  // onLoad con el tamaño real; hasta que la imagen carga se mantiene
  // invisible para que no haya un "salto" si la pista era errónea.
  const [padded, setPadded] = useState(() => guessPaddedFromUrl(src));
  const [loaded, setLoaded] = useState(false);

  if (!src) return null;

  return (
    <img
      src={src}
      alt=""
      draggable={false}
      onLoad={(e) => {
        setPadded(e.target.naturalWidth >= MASCOT_OVERLAY_PADDED_MIN_PX);
        setLoaded(true);
      }}
      className="absolute object-contain select-none pointer-events-none"
      style={{ ...styleFor(padded), visibility: loaded ? 'visible' : 'hidden' }}
    />
  );
}

// Versión para markup construido como string (los marcadores de Leaflet en
// GlobeLocationView.jsx): misma detección por naturalWidth, hecha con un
// handler onload inline porque ahí no hay React. Los números 320 / 30 son
// MASCOT_OVERLAY_PADDED_MIN_PX y MASCOT_OVERLAY_PAD·100 — si cambian allí,
// cambiar aquí.
export function mascotOverlayHtml(src) {
  if (!src) return '';
  const safeSrc = String(src).replace(/"/g, '&quot;');
  return (
    `<img src="${safeSrc}" ` +
    `style="position:absolute;left:0;top:0;width:100%;height:100%;object-fit:contain;pointer-events:none;visibility:hidden;" ` +
    `onload="if(this.naturalWidth>=320){this.style.left='-30%';this.style.top='-30%';this.style.width='160%';this.style.height='160%';}this.style.visibility='visible';" />`
  );
}
