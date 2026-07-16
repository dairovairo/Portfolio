import { useEffect, useRef } from 'react';

/**
 * AudienceCircleMap — muestra un mapa con el punto del evento y un círculo
 * verde alrededor cuyo radio es controlado por el padre. Sirve como
 * preview del filtro por ubicación en EventAdConfigPage. No permite mover
 * el centro (es la ubicación fija del evento) ni redimensionar el círculo
 * con el ratón — el radio se cambia con el slider del padre.
 *
 * Reutiliza el loader Leaflet de LocationPicker.jsx (CDN idempotente, se
 * carga una vez y luego cachea window.L).
 *
 * Props:
 *   centerLat, centerLng — punto del evento en WGS-84
 *   radiusKm             — radio en km, entre 1 y 500
 *   heightPx             — altura del contenedor (defecto 240)
 */

const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS  = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet-src.js';

let leafletLoadPromise = null;
function loadLeaflet() {
  if (leafletLoadPromise) return leafletLoadPromise;
  leafletLoadPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = LEAFLET_CSS;
      document.head.appendChild(link);
    }
    if (window.L) { resolve(window.L); return; }
    const script = document.createElement('script');
    script.src = LEAFLET_JS;
    script.onload = () => resolve(window.L);
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return leafletLoadPromise;
}

export default function AudienceCircleMap({ centerLat, centerLng, radiusKm, heightPx = 240 }) {
  const containerRef = useRef(null);
  const mapRef       = useRef(null);
  const circleRef    = useRef(null);
  const markerRef    = useRef(null);

  // Inicialización del mapa (una vez, cuando aparecen center y ref).
  useEffect(() => {
    let cancelled = false;
    if (centerLat == null || centerLng == null) return;

    loadLeaflet().then(L => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = L.map(containerRef.current, {
        center: [centerLat, centerLng],
        zoom: 10,
        zoomControl: true,
        attributionControl: false,
        scrollWheelZoom: false, // el usuario no espera zoom con scroll en un preview embebido
      });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
      }).addTo(map);

      markerRef.current = L.marker([centerLat, centerLng]).addTo(map);
      circleRef.current = L.circle([centerLat, centerLng], {
        radius: (radiusKm || 1) * 1000, // Leaflet usa metros
        color: '#22c55e',     // verde-500 tailwind
        fillColor: '#22c55e',
        fillOpacity: 0.15,
        weight: 2,
      }).addTo(map);
      mapRef.current = map;

      // Ajusta el viewport al círculo con un pequeño padding.
      const bounds = circleRef.current.getBounds();
      map.fitBounds(bounds, { padding: [20, 20] });
    });

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markerRef.current = null;
        circleRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // solo al montar

  // Actualiza radio + centro sin recrear el mapa.
  useEffect(() => {
    if (!mapRef.current || !circleRef.current || centerLat == null || centerLng == null) return;
    const L = window.L;
    if (!L) return;
    markerRef.current.setLatLng([centerLat, centerLng]);
    circleRef.current.setLatLng([centerLat, centerLng]);
    circleRef.current.setRadius((radiusKm || 1) * 1000);
    const bounds = circleRef.current.getBounds();
    mapRef.current.fitBounds(bounds, { padding: [20, 20], animate: true });
  }, [centerLat, centerLng, radiusKm]);

  if (centerLat == null || centerLng == null) {
    return (
      <div
        className="rounded-2xl border border-surface-border bg-surface-card/40 grid place-items-center text-xs font-mono text-surface-muted"
        style={{ height: heightPx }}
      >
        Sin ubicación del evento
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="rounded-2xl overflow-hidden border border-surface-border"
      style={{ height: heightPx }}
    />
  );
}
