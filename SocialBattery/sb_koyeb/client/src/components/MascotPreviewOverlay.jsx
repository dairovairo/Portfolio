/**
 * MascotPreviewOverlay — muestra el PNG "horneado" de la personalización de
 * otro usuario (users.mascot_preview_url) superpuesto 1:1 sobre su mascota
 * base. Único sitio donde debe renderizarse ese overlay (tarjeta de amigo,
 * miembros de grupo/quedada, localizador de eventos, sniffer, perfil ajeno,
 * marcadores del mapa…) — antes cada vista repetía el mismo <img> inline.
 *
 * El PNG mide exactamente el cuadrado de la mascota, así que basta con
 * superponerlo a tamaño completo. El único ítem cuyo contenido desbordaría
 * ese cuadrado (la riñonera) ya se hornea reencuadrado dentro del propio
 * PNG — ver clampRinonInside en lib/mascotRenderer.js — de modo que aquí
 * no hace falta ninguna lógica especial.
 */
export default function MascotPreviewOverlay({ src }) {
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none"
    />
  );
}

// Variante en string HTML para sitios que construyen el DOM a mano (los
// divIcon de Leaflet en GlobeLocationView.jsx). Misma lógica que arriba.
export function mascotPreviewOverlayHtml(src) {
  if (!src) return '';
  return `<img src="${src}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;" />`;
}
