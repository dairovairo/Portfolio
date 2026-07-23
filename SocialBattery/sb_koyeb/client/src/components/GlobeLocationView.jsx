import { useEffect, useRef, useState } from 'react';
import { useTheme } from '../context/ThemeContext';
import { MASCOT_BASE } from '../context/MascotContext';
import { mascotPreviewOverlayHtml } from './MascotPreviewOverlay';

/**
 * GlobeLocationView — mapa de ubicación para EventLocatorPage y
 * PoolSnifferPage.
 *
 * Mapa 2D detallado (Leaflet) con teselas oscuras o claras según el tema
 * de la app (CARTO dark_all / light_all — sin API key), con precisión y
 * zoom reales (hasta nivel calle).
 *
 * Props:
 *   lat, lng {number}
 *   label    {string|null}
 *   friends  {Array<{user_id, username, avatar_url, battery_level, mascot_preview_url, lat, lng, isMe}>}
 */

// Mismo criterio de tier que usa el resto de la app (ver getMascotTier en
// FriendCard.jsx / HomePage.jsx / PoolSnifferPage.jsx): 0-33 → low, 34-66 →
// mid, 67-100 → high.
function tierFromBatteryLevel(level) {
  const l = level ?? 50;
  if (l <= 33) return 'low';
  if (l <= 66) return 'mid';
  return 'high';
}

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

// Marcador combinado: la mascota (capa base según tier + overlay
// "horneado" con su personalización, mismo patrón que FriendCard.jsx /
// MiniMascot en PoolSnifferPage.jsx) como icono principal, con la foto de
// perfil como insignia pequeña en la esquina — así se ve tanto la mascota
// como la foto de usuario en el propio mapa, no solo en las listas.
function friendMarkerHtml(friend) {
  const initial = (friend.username || '?').charAt(0).toUpperCase();
  const ringColor = friend.isMe ? '#fbbf24' : '#60a5fa';
  const baseSrc = MASCOT_BASE[tierFromBatteryLevel(friend.battery_level)];
  const overlay = mascotPreviewOverlayHtml(friend.mascot_preview_url);
  const avatarInner = friend.avatar_url
    ? `<img src="${friend.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:9999px;display:block;" />`
    : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;background:#1e293b;border-radius:9999px;">${initial}</div>`;
  return `
    <div style="position:relative;width:42px;height:42px;">
      <div style="position:absolute;inset:0;filter:drop-shadow(0 2px 5px rgba(0,0,0,.5));">
        <img src="${baseSrc}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;" />
        ${overlay}
      </div>
      <div style="position:absolute;bottom:-3px;right:-3px;width:18px;height:18px;border-radius:9999px;border:2px solid ${ringColor};overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.6);background:#0f172a;">
        ${avatarInner}
      </div>
    </div>
  `;
}

// ── Mapa 2D detallado (oscuro/claro según tema) ─────────────────────────
function FlatMapView({ lat, lng, label, isDark, friends, radiusCircleMeters }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const friendMarkersRef = useRef(new Map()); // user_id -> L.Marker
  const circleRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState('');

  // Actualiza/crea/elimina marcadores de amigos sin recrear el mapa
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.L) return;
    const L = window.L;
    const liveFriends = friends.filter(f => f.lat != null && f.lng != null);
    const seenIds = new Set();

    liveFriends.forEach(f => {
      seenIds.add(f.user_id);
      const existing = friendMarkersRef.current.get(f.user_id);
      if (existing) {
        existing.setLatLng([f.lat, f.lng]);
      } else {
        const icon = L.divIcon({ html: friendMarkerHtml(f), className: '', iconSize: [42, 42], iconAnchor: [21, 21], popupAnchor: [0, -22] });
        const marker = L.marker([f.lat, f.lng], { icon, zIndexOffset: 500 }).addTo(map);
        marker.bindPopup(
          `<span style="font-size:12px;font-family:monospace;">${f.isMe ? 'Tú' : (f.username || 'Amigo')}</span>`,
          { maxWidth: 160 }
        );
        friendMarkersRef.current.set(f.user_id, marker);
      }
    });

    // elimina marcadores de quien ya no comparte ubicación
    for (const [uid, marker] of friendMarkersRef.current.entries()) {
      if (!seenIds.has(uid)) {
        map.removeLayer(marker);
        friendMarkersRef.current.delete(uid);
      }
    }
  }, [friends, ready]);

  useEffect(() => {
    let cancelled = false;

    loadLeaflet().then(L => {
      if (cancelled || !containerRef.current || mapRef.current) return;

      const map = L.map(containerRef.current, {
        center: [lat, lng],
        zoom: 16,
        zoomControl: true,
        attributionControl: false,
        dragging: true,
        scrollWheelZoom: false,
        doubleClickZoom: true,
      });

      const tileUrl = isDark
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
      L.tileLayer(tileUrl, { maxZoom: 19, subdomains: 'abcd' }).addTo(map);

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

      // Círculo de precisión aproximada (verde clarito), p.ej. para el modo
      // Sniffer de quedadas: la ubicación es un texto geocodificado, no un
      // punto exacto, así que un radio ilustra ese margen de error.
      if (radiusCircleMeters) {
        circleRef.current = L.circle([lat, lng], {
          radius: radiusCircleMeters,
          color: '#86efac',
          weight: 1.5,
          fillColor: '#86efac',
          fillOpacity: 0.18,
        }).addTo(map);
      }

      mapRef.current = map;
      setReady(true);
    }).catch(() => setErr('No se pudo cargar el mapa'));

    return () => {
      cancelled = true;
      friendMarkersRef.current.clear();
      circleRef.current = null;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, isDark, radiusCircleMeters]);

  return (
    <div className="relative w-full h-full">
      {!ready && !err && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-bg z-10">
          <div className="flex flex-col items-center gap-2 text-surface-muted">
            <div className="w-5 h-5 border-2 border-accent-primary/40 border-t-accent-primary rounded-full animate-spin" />
            <span className="text-xs font-mono">Cargando mapa…</span>
          </div>
        </div>
      )}
      {err && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-bg text-xs text-slate-500 font-mono">
          {err}
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}

// ── Componente principal ─────────────────────────────────────────────────
// friends {Array<{user_id, username, avatar_url, lat, lng, isMe}>} — posición
// en vivo de los miembros ACEPTADOS del grupo de localización (la gestiona
// EventLocatorPage con watchPosition + Realtime). Puede venir vacío si aún
// no hay grupo o nadie ha compartido ubicación todavía.
export default function GlobeLocationView({ lat, lng, label, friends = [], radiusCircleMeters = 0 }) {
  const { isDark } = useTheme();

  if (lat == null || lng == null) return null;

  const liveCount = friends.filter(f => f.lat != null && f.lng != null && !f.isMe).length;

  return (
    <div className="bg-surface-card border border-surface-border rounded-2xl overflow-hidden">
      <div className="relative" style={{ height: 260 }}>
        <FlatMapView lat={lat} lng={lng} label={label} isDark={isDark} friends={friends} radiusCircleMeters={radiusCircleMeters} />

        {liveCount > 0 && (
          <div className="absolute top-2.5 left-2.5 z-20 flex items-center gap-1.5 bg-black/40 backdrop-blur-md border border-white/10 rounded-full pl-1.5 pr-2.5 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] font-mono text-white/90">
              {liveCount} {liveCount === 1 ? 'amigo' : 'amigos'} en vivo
            </span>
          </div>
        )}
      </div>

      {label && (
        <div className="px-4 py-2.5 border-t border-surface-border flex items-center gap-2">
          <span className="text-sm">📍</span>
          <span className="text-xs font-mono text-surface-muted truncate">{label}</span>
        </div>
      )}
    </div>
  );
}
