import { useEffect, useRef, useState } from 'react';
import { useTheme } from '../context/ThemeContext';

/**
 * GlobeLocationView — "bola del mundo" interactiva para EventLocatorPage.
 *
 * Dos modos:
 *  - 'globe': globo 3D nocturno (globe.gl / three.js vía CDN) con vuelo
 *    cinematográfico hasta el pin del evento, atmósfera con el color de
 *    acento del tema activo y anillos de pulso sobre la ubicación.
 *  - 'map': mapa 2D detallado (Leaflet) con teselas oscuras o claras según
 *    el tema de la app (CARTO dark_all / light_all — sin API key).
 *
 * Props:
 *   lat, lng {number}
 *   label    {string|null}
 */

const GLOBE_JS       = 'https://unpkg.com/globe.gl';
const EARTH_NIGHT_IMG = 'https://unpkg.com/three-globe/example/img/earth-night.jpg';
const EARTH_BUMP_IMG  = 'https://unpkg.com/three-globe/example/img/earth-topology.png';
const NIGHT_SKY_IMG    = 'https://unpkg.com/three-globe/example/img/night-sky.png';
const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS  = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet-src.js';

let globeLoadPromise = null;
function loadGlobeGL() {
  if (globeLoadPromise) return globeLoadPromise;
  globeLoadPromise = new Promise((resolve, reject) => {
    if (window.Globe) { resolve(window.Globe); return; }
    const script = document.createElement('script');
    script.src = GLOBE_JS;
    script.onload = () => resolve(window.Globe);
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return globeLoadPromise;
}

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

let pinStyleInjected = false;
function ensurePinStyles() {
  if (pinStyleInjected) return;
  pinStyleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes sb-pin-pulse {
      0%   { transform: scale(0.6); opacity: 0.85; }
      70%  { transform: scale(2.6); opacity: 0; }
      100% { transform: scale(2.6); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}

function makePinEl(color) {
  ensurePinStyles();
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;width:0;height:0;pointer-events:none;';
  wrap.innerHTML = `
    <div style="position:absolute;left:-16px;top:-16px;width:32px;height:32px;border-radius:9999px;background:${color};opacity:0.55;animation:sb-pin-pulse 1.8s ease-out infinite;"></div>
    <div style="position:absolute;left:-13px;top:-31px;font-size:24px;line-height:1;filter:drop-shadow(0 2px 5px rgba(0,0,0,.7));">📍</div>
  `;
  return wrap;
}

function rgbTriplet(cssColor, fallback = '45,212,220') {
  const m = /rgb\(([^)]+)\)/.exec(cssColor || '');
  return m ? m[1].replace(/\s+/g, '') : fallback;
}

// ── Tile engine (imagenes reales de mapa sobre la esfera) ───────────────
// El globo por defecto envuelve una textura estatica de ~2K px (earth-night),
// que se ve nitida vista entera pero se pixela/difumina en cuanto se hace
// zoom porque no hay mas resolucion que extraer de esa imagen. Para tener
// precision real al acercarse, se cubre la esfera con teselas reales tipo
// "slippy map" (las mismas CARTO usadas en el modo Mapa 2D), que se piden
// en la resolucion adecuada segun la distancia de la camara — igual que
// Google Earth. La textura earth-night queda solo como fondo de transicion
// mientras las teselas cargan o en las zonas aun no cubiertas.
const TILE_SUBDOMAINS = 'abcd';
const GLOBE_TILE_MAX_ZOOM = 19;

function buildGlobeTileUrl(x, y, l, isDark) {
  const s = TILE_SUBDOMAINS[(x + y) % TILE_SUBDOMAINS.length];
  const style = isDark ? 'dark_all' : 'light_all';
  const retina = (typeof window !== 'undefined' && window.devicePixelRatio > 1) ? '@2x' : '';
  return `https://${s}.basemaps.cartocdn.com/${style}/${l}/${x}/${y}${retina}.png`;
}

// Avatar circular de un miembro del grupo de localización (globo 3D)
function makeFriendEl(friend) {
  ensurePinStyles();
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;width:0;height:0;pointer-events:none;';
  const size = 28;
  const initial = (friend.username || '?').charAt(0).toUpperCase();
  const ringColor = friend.isMe ? '#fbbf24' : '#60a5fa';
  const avatarInner = friend.avatar_url
    ? `<img src="${friend.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:9999px;display:block;" />`
    : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;background:#1e293b;">${initial}</div>`;
  wrap.innerHTML = `
    <div style="position:absolute;left:${-size / 2}px;top:${-size / 2}px;width:${size}px;height:${size}px;border-radius:9999px;border:2px solid ${ringColor};overflow:hidden;box-shadow:0 2px 6px rgba(0,0,0,.6);"></div>
    <div style="position:absolute;left:${-size / 2 + 1}px;top:${-size / 2 + 1}px;width:${size - 2}px;height:${size - 2}px;border-radius:9999px;overflow:hidden;">${avatarInner}</div>
    <div style="position:absolute;left:${size / 2 - 8}px;top:${-size / 2 - 2}px;width:9px;height:9px;border-radius:9999px;background:${ringColor};box-shadow:0 0 0 2px rgba(0,0,0,.55);"></div>
  `;
  return wrap;
}

// ── Modo globo 3D ────────────────────────────────────────────────────────
function GlobeView({ lat, lng, friends, isDark }) {
  const containerRef = useRef(null);
  const globeRef = useRef(null);
  const isDarkRef = useRef(isDark);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState('');

  // El estilo de tesela (oscuro/claro) se lee de una ref dentro del callback
  // del tile engine, para poder cambiar de tema sin tener que reconstruir
  // el globo entero.
  useEffect(() => {
    isDarkRef.current = isDark;
  }, [isDark]);

  // Recalcula los marcadores (pin del evento + avatares en vivo) sin
  // recrear el globo entero cada vez que llega una actualización de
  // ubicación — solo se refresca la capa de htmlElements.
  useEffect(() => {
    if (!globeRef.current) return;
    const markers = [
      { type: 'event', lat, lng },
      ...friends.filter(f => f.lat != null && f.lng != null).map(f => ({ type: 'friend', ...f })),
    ];
    globeRef.current.htmlElementsData(markers);
  }, [friends, lat, lng]);

  useEffect(() => {
    let cancelled = false;
    let resizeObserver;

    loadGlobeGL().then(Globe => {
      if (cancelled || !containerRef.current || globeRef.current) return;
      const el = containerRef.current;

      const accent = getComputedStyle(document.documentElement)
        .getPropertyValue('--sb-accent-glow').trim() || 'rgb(45, 212, 220)';
      const triplet = rgbTriplet(accent);

      const initialMarkers = [
        { type: 'event', lat, lng },
        ...friends.filter(f => f.lat != null && f.lng != null).map(f => ({ type: 'friend', ...f })),
      ];

      const world = Globe()(el)
        .globeImageUrl(EARTH_NIGHT_IMG)
        .bumpImageUrl(EARTH_BUMP_IMG)
        .backgroundImageUrl(NIGHT_SKY_IMG)
        // Teselas de mapa reales sobre la esfera: dan precisión de calle al
        // acercarse en vez de la textura estática de earth-night (que se
        // difumina porque no tiene más píxeles que dar). earth-night sigue
        // sirviendo de fondo mientras las teselas cargan o en zonas sin cubrir.
        .globeTileEngineUrl((x, y, l) => buildGlobeTileUrl(x, y, l, isDarkRef.current))
        .globeTileEngineMaxZoom(GLOBE_TILE_MAX_ZOOM)
        .showAtmosphere(true)
        .atmosphereColor(accent)
        .atmosphereAltitude(0.22)
        .pointsData([{ lat, lng }])
        .pointColor(() => accent)
        .pointAltitude(0.005)
        .pointRadius(0.35)
        .ringsData([{ lat, lng }])
        .ringColor(() => t => `rgba(${triplet},${1 - t})`)
        .ringMaxRadius(4.5)
        .ringPropagationSpeed(2.2)
        .ringRepeatPeriod(1400)
        .htmlElementsData(initialMarkers)
        .htmlElement(d => (d.type === 'event' ? makePinEl(accent) : makeFriendEl(d)))
        .width(el.clientWidth)
        .height(el.clientHeight);

      // Renderiza a la densidad de píxeles real de la pantalla (hasta 2x).
      // Sin esto, en pantallas retina/alta densidad el canvas se dibuja a
      // 1px lógico = 1px físico y el resultado se ve blando/borroso aunque
      // la tesela cargada sea nítida.
      try {
        world.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      } catch { /* noop */ }

      const controls = world.controls();
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.7;
      controls.enableZoom = true;
      controls.zoomSpeed = 0.7;
      // Antes se cortaba el zoom a 120 (globo radio 100 ⇒ solo 20 unidades
      // de margen), lo que impedía acercarse más allá de una vista de país.
      // Con teselas reales ya podemos dejar acercarse casi a ras de suelo.
      controls.minDistance = 100.6;
      controls.maxDistance = 420;

      // Vista alejada inicial, luego "vuelo" cinematográfico hasta un
      // encuadre cercano (nivel calle) donde ya se aprecian las teselas.
      world.pointOfView({ lat, lng, altitude: 2.4 }, 0);
      const flyTimer = setTimeout(() => {
        if (!cancelled) world.pointOfView({ lat, lng, altitude: 0.25 }, 2600);
      }, 350);

      resizeObserver = new ResizeObserver(() => {
        if (!containerRef.current) return;
        world.width(containerRef.current.clientWidth);
        world.height(containerRef.current.clientHeight);
        try {
          world.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        } catch { /* noop */ }
      });
      resizeObserver.observe(el);

      globeRef.current = world;
      globeRef.current._flyTimer = flyTimer;
      setReady(true);
    }).catch(() => setErr('No se pudo cargar el globo'));

    return () => {
      cancelled = true;
      if (resizeObserver) resizeObserver.disconnect();
      if (globeRef.current) {
        clearTimeout(globeRef.current._flyTimer);
        try { globeRef.current._destructor?.(); } catch { /* noop */ }
        globeRef.current = null;
      }
      if (containerRef.current) containerRef.current.innerHTML = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  return (
    <div className="relative w-full h-full">
      {!ready && !err && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#050510] z-10">
          <div className="flex flex-col items-center gap-2 text-surface-muted">
            <div className="w-5 h-5 border-2 border-accent-primary/40 border-t-accent-primary rounded-full animate-spin" />
            <span className="text-xs font-mono">Cargando globo…</span>
          </div>
        </div>
      )}
      {err && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#050510] text-xs text-slate-500 font-mono px-4 text-center">
          {err}
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}

function friendMarkerHtml(friend) {
  const initial = (friend.username || '?').charAt(0).toUpperCase();
  const ringColor = friend.isMe ? '#fbbf24' : '#60a5fa';
  const inner = friend.avatar_url
    ? `<img src="${friend.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:9999px;display:block;" />`
    : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;background:#1e293b;">${initial}</div>`;
  return `
    <div style="position:relative;width:30px;height:30px;">
      <div style="width:28px;height:28px;border-radius:9999px;border:2px solid ${ringColor};overflow:hidden;box-shadow:0 2px 6px rgba(0,0,0,.55);">${inner}</div>
    </div>
  `;
}

// ── Modo mapa 2D detallado (oscuro/claro según tema) ────────────────────
function FlatMapView({ lat, lng, label, isDark, friends }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const friendMarkersRef = useRef(new Map()); // user_id -> L.Marker
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
        const icon = L.divIcon({ html: friendMarkerHtml(f), className: '', iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -16] });
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

      mapRef.current = map;
      setReady(true);
    }).catch(() => setErr('No se pudo cargar el mapa'));

    return () => {
      cancelled = true;
      friendMarkersRef.current.clear();
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, isDark]);

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
export default function GlobeLocationView({ lat, lng, label, friends = [] }) {
  const { isDark } = useTheme();
  const [mode, setMode] = useState('globe'); // 'globe' | 'map'

  if (lat == null || lng == null) return null;

  const liveCount = friends.filter(f => f.lat != null && f.lng != null && !f.isMe).length;

  return (
    <div className="bg-surface-card border border-surface-border rounded-2xl overflow-hidden">
      <div className="relative" style={{ height: 260 }}>
        {mode === 'globe'
          ? <GlobeView key="globe" lat={lat} lng={lng} friends={friends} isDark={isDark} />
          : <FlatMapView key="map" lat={lat} lng={lng} label={label} isDark={isDark} friends={friends} />}

        {liveCount > 0 && (
          <div className="absolute top-2.5 left-2.5 z-20 flex items-center gap-1.5 bg-black/40 backdrop-blur-md border border-white/10 rounded-full pl-1.5 pr-2.5 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] font-mono text-white/90">
              {liveCount} {liveCount === 1 ? 'amigo' : 'amigos'} en vivo
            </span>
          </div>
        )}

        <div className="absolute top-2.5 right-2.5 z-20 flex bg-black/40 backdrop-blur-md border border-white/10 rounded-full p-0.5 gap-0.5">
          <button
            type="button"
            onClick={() => setMode('globe')}
            className={`px-2.5 py-1 rounded-full text-[11px] font-display font-semibold transition-colors ${
              mode === 'globe' ? 'bg-white text-black' : 'text-white/70 hover:text-white'
            }`}
          >
            🌍 Globo
          </button>
          <button
            type="button"
            onClick={() => setMode('map')}
            className={`px-2.5 py-1 rounded-full text-[11px] font-display font-semibold transition-colors ${
              mode === 'map' ? 'bg-white text-black' : 'text-white/70 hover:text-white'
            }`}
          >
            🗺️ Mapa
          </button>
        </div>
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
