import { useEffect, useRef, useState } from 'react';

/**
 * LocationMapView — mapa de sólo lectura con pin fijo.
 *
 * Props:
 *   lat    {number}        — latitud
 *   lng    {number}        — longitud
 *   label  {string|null}  — tooltip del marcador (opcional)
 *
 * Usa Leaflet (CDN) + OpenStreetMap. Sin API key.
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

export default function LocationMapView({ lat, lng, label }) {
  const containerRef = useRef(null);
  const mapRef       = useRef(null);
  const [ready, setReady] = useState(false);
  const [err,   setErr]   = useState('');

  useEffect(() => {
    if (lat == null || lng == null) return;
    let cancelled = false;

    loadLeaflet().then(L => {
      if (cancelled || !containerRef.current || mapRef.current) return;

      const map = L.map(containerRef.current, {
        center: [lat, lng],
        zoom: 15,
        zoomControl: true,
        attributionControl: false,
        dragging: true,
        scrollWheelZoom: false, // evita scroll accidental en móvil
        doubleClickZoom: true,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
      }).addTo(map);

      const icon = L.divIcon({
        html: '<div style="font-size:28px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,.8))">📍</div>',
        className: '',
        iconSize: [28, 28],
        iconAnchor: [14, 28],
        popupAnchor: [0, -32],
      });

      const marker = L.marker([lat, lng], { icon }).addTo(map);
      if (label) {
        marker.bindPopup(
          `<span style="font-size:12px;font-family:monospace;white-space:normal;max-width:200px;display:block">${label}</span>`,
          { maxWidth: 220 }
        );
      }

      mapRef.current = map;
      setReady(true);
    }).catch(() => {
      setErr('No se pudo cargar el mapa');
    });

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (lat == null || lng == null) return null;

  return (
    <div className="rounded-xl overflow-hidden border border-surface-border" style={{ height: 200 }}>
      {!ready && !err && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-bg z-10 rounded-xl">
          <div className="flex flex-col items-center gap-2 text-surface-muted">
            <div className="w-5 h-5 border-2 border-accent-primary/40 border-t-accent-primary rounded-full animate-spin" />
            <span className="text-xs font-mono">Cargando mapa…</span>
          </div>
        </div>
      )}
      {err && (
        <div className="h-full flex items-center justify-center bg-surface-bg text-xs text-slate-500 font-mono">
          {err}
        </div>
      )}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
